import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const CALLBACK_PATH = '/oauth/openrouter'
const AUTH_TIMEOUT_MS = 10 * 60 * 1_000
const EXCHANGE_TIMEOUT_MS = 15_000
const MAX_EXCHANGE_BODY_BYTES = 16_384

export interface OpenRouterOAuthResult {
  ok: boolean
  error?: string
}

/** A one-shot PKCE authorization server bound only to IPv4 loopback. */
export class OpenRouterOAuth {
  private pendingServer: Server | null = null
  private cancelPending: (() => void) | null = null

  async connect(openExternal: (url: string) => Promise<void>, saveApiKey: (key: string) => Promise<void>): Promise<OpenRouterOAuthResult> {
    if (this.pendingServer) return { ok: false, error: 'An OpenRouter sign-in is already in progress.' }

    const server = createServer()
    server.on('error', () => this.cancelPending?.())
    server.maxHeadersCount = 20
    server.headersTimeout = 10_000
    server.requestTimeout = 15_000
    server.keepAliveTimeout = 1_000
    server.on('connection', (socket) => socket.setTimeout(15_000, () => socket.destroy()))
    this.pendingServer = server
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(32).toString('base64url')
    let timeout: ReturnType<typeof setTimeout> | undefined
    let settled = false
    let resolveCode!: (code: string) => void
    let rejectCode!: (error: Error) => void
    const codePromise = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject })
    void codePromise.catch(() => undefined)
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      callback()
    }
    const cancel = (): void => finish(() => rejectCode(new Error('OpenRouter sign-in was cancelled.')))
    this.cancelPending = cancel

    try {
      let callbackAttempts = 0
      server.on('request', (request, response) => {
        callbackAttempts += 1
        if (callbackAttempts > 12) {
          reply(response, 429, 'Too many sign-in callback attempts. Return to LifeAssistOS and try again.')
          finish(() => rejectCode(new Error('Too many sign-in callback attempts. Start again to retry.')))
          return
        }
        handleCallback(request, response, server, state, finish, resolveCode, rejectCode)
      })
      const port = await listenLoopback(server)
      timeout = setTimeout(() => finish(() => rejectCode(new Error('OpenRouter sign-in timed out. Start again to retry.'))), AUTH_TIMEOUT_MS)

      const callbackUrl = `http://127.0.0.1:${port}${CALLBACK_PATH}`
      const authorization = new URL('https://openrouter.ai/auth')
      authorization.searchParams.set('callback_url', callbackUrl)
      authorization.searchParams.set('code_challenge', challenge)
      authorization.searchParams.set('code_challenge_method', 'S256')
      authorization.searchParams.set('key_label', 'LifeAssistOS')
      authorization.searchParams.set('state', state)
      await openExternal(authorization.toString())

      const code = await codePromise
      const key = await exchangeCode(code, verifier)
      await saveApiKey(key)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'OpenRouter sign-in could not be completed.' }
    } finally {
      if (timeout) clearTimeout(timeout)
      if (this.pendingServer === server) this.pendingServer = null
      this.cancelPending = null
      await closeServer(server)
    }
  }

  cancel(): void {
    this.cancelPending?.()
  }
}

function handleCallback(
  request: IncomingMessage,
  response: ServerResponse,
  server: Server,
  expectedState: string,
  finish: (callback: () => void) => void,
  resolveCode: (code: string) => void,
  rejectCode: (error: Error) => void
): void {
  const remoteAddress = request.socket.remoteAddress
  if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::ffff:127.0.0.1') {
    reply(response, 403, 'This sign-in callback is available only to LifeAssistOS on this device.')
    return
  }

  let callback: URL
  try { callback = new URL(request.url ?? '/', 'http://127.0.0.1') }
  catch { reply(response, 400, 'Invalid sign-in callback.'); return }

  const address = server.address()
  const expectedHost = address && typeof address === 'object' ? `127.0.0.1:${address.port}` : ''
  if (request.method !== 'GET' || callback.pathname !== CALLBACK_PATH || request.headers.host !== expectedHost) {
    reply(response, 404, 'This sign-in callback is not available.')
    return
  }

  const code = callback.searchParams.get('code') ?? ''
  const returnedState = callback.searchParams.get('state') ?? ''
  if (!sameSecret(returnedState, expectedState)) {
    reply(response, 400, 'The sign-in response could not be verified. Return to LifeAssistOS and try again.')
    return
  }
  if (callback.searchParams.get('error') === 'access_denied') {
    reply(response, 200, 'OpenRouter sign-in was cancelled. You can return to LifeAssistOS.')
    finish(() => rejectCode(new Error('OpenRouter sign-in was cancelled.')))
    return
  }
  if (!/^[A-Za-z0-9._~-]{1,4096}$/.test(code)) {
    reply(response, 400, 'The sign-in response could not be verified. Return to LifeAssistOS and try again.')
    return
  }

  reply(response, 200, 'OpenRouter authorized. You can return to LifeAssistOS.')
  finish(() => resolveCode(code))
}

function sameSecret(first: string, second: string): boolean {
  const left = Buffer.from(first)
  const right = Buffer.from(second)
  return left.length === right.length && timingSafeEqual(left, right)
}

function reply(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Content-Type': 'text/plain; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(message)
}

async function listenLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onError)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not start the local sign-in callback.')
  return address.port
}

async function exchangeCode(code: string, verifier: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS)
  try {
    const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' })
    })
    const text = await readBoundedBody(response)
    if (!response.ok) throw new Error(response.status === 403
      ? 'OpenRouter could not verify the sign-in code. Start again to retry.'
      : 'OpenRouter could not complete sign-in. Try again.')
    let payload: unknown
    try { payload = JSON.parse(text) }
    catch { throw new Error('OpenRouter returned an unreadable sign-in response.') }
    const parsed = z.object({ key: z.string().min(1).max(4_096) }).passthrough().safeParse(payload)
    if (!parsed.success) throw new Error('OpenRouter returned an invalid API key response.')
    return parsed.data.key
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('OpenRouter sign-in timed out. Start again to retry.')
    if (error instanceof Error && error.message.startsWith('OpenRouter ')) throw error
    throw new Error('Could not reach OpenRouter to finish sign-in. Check your connection and try again.')
  } finally {
    clearTimeout(timeout)
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_EXCHANGE_BODY_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('OpenRouter returned an oversized sign-in response.')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_EXCHANGE_BODY_BYTES) {
        await reader.cancel()
        throw new Error('OpenRouter returned an oversized sign-in response.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(body)
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}
