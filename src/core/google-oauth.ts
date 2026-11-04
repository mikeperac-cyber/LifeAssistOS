import { createServer, type Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'

export interface OAuthVerifier {
  codeVerifier: string
  codeChallenge?: string
}

export interface GoogleOAuthTokens {
  access_token?: string | null
  refresh_token?: string | null
  expiry_date?: number | null
  scope?: string | null
}

export interface GoogleAuthorizedTokens extends GoogleOAuthTokens {
  access_token: string
  refresh_token: string
}

export interface GoogleOAuthClient {
  generateCodeVerifierAsync(): Promise<OAuthVerifier>
  generateAuthUrl(options: Record<string, string>): string
  getToken(options: { code: string; codeVerifier: string; redirect_uri: string }): Promise<{ tokens: GoogleOAuthTokens }>
}

export interface GoogleDesktopOAuthOptions {
  clientId: string
  scopes: string[]
  permissionLabel: string
  openExternal: (url: string) => Promise<void>
  oauthClient?: (clientId: string) => GoogleOAuthClient
}

export function normalizeGoogleClientId(input: string, allowEmpty = false): string {
  const value = input.trim()
  if (!value && allowEmpty) return ''
  if (
    value.length > 256 ||
    !/^\d{6,}-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(value)
  ) {
    throw new Error('Enter a Google OAuth Client ID for a Desktop app (ending in .apps.googleusercontent.com).')
  }
  return value
}

/** Runs Google's installed-app authorization-code flow with PKCE and a state-checked loopback callback. */
export async function authorizeGoogleDesktop(options: GoogleDesktopOAuthOptions): Promise<GoogleAuthorizedTokens> {
  const clientId = normalizeGoogleClientId(options.clientId)
  const scopes = [...new Set(options.scopes.map((scope) => scope.trim()).filter(Boolean))]
  if (!scopes.length || scopes.length > 10) throw new Error('Choose valid Google permissions before connecting.')

  const oauth: GoogleOAuthClient = options.oauthClient?.(clientId) ?? new OAuth2Client(clientId)
  const verifier = await oauth.generateCodeVerifierAsync()
  if (!verifier.codeChallenge || !verifier.codeVerifier) {
    throw new Error('Google OAuth could not create a PKCE challenge.')
  }
  const state = randomBytes(32).toString('base64url')
  const receiver = await createGoogleOAuthReceiver(state)

  try {
    const authorizationUrl = oauth.generateAuthUrl({
      client_id: clientId,
      redirect_uri: receiver.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: verifier.codeChallenge,
      code_challenge_method: 'S256'
    })
    const authUrl = new URL(authorizationUrl)
    if (
      authUrl.origin !== 'https://accounts.google.com' ||
      authUrl.pathname !== '/o/oauth2/v2/auth' ||
      authUrl.username || authUrl.password || authUrl.port || authUrl.hash
    ) {
      throw new Error('Google OAuth produced an unexpected authorization URL.')
    }
    await options.openExternal(authUrl.toString())
    const code = await receiver.waitForCode(180_000)
    const tokenResponse = await oauth.getToken({
      code,
      codeVerifier: verifier.codeVerifier,
      redirect_uri: receiver.redirectUri
    })
    const tokens = tokenResponse.tokens
    const grantedScopes = (tokens.scope ?? '').split(/\s+/).filter(Boolean)
    if (!tokens.access_token || !tokens.refresh_token || scopes.some((scope) => !grantedScopes.includes(scope))) {
      throw new Error(`Google did not grant the requested ${options.permissionLabel} access. No connection was saved.`)
    }
    return tokens as GoogleAuthorizedTokens
  } catch (error) {
    throw friendlyOAuthError(error)
  } finally {
    await receiver.close()
  }
}

interface GoogleOAuthReceiver {
  redirectUri: string
  waitForCode(timeoutMs: number): Promise<string>
  close(): Promise<void>
}

/** Opens a one-request IPv4 loopback receiver bound only to 127.0.0.1. */
export async function createGoogleOAuthReceiver(expectedState: string): Promise<GoogleOAuthReceiver> {
  let resolveCode: (code: string) => void = () => undefined
  let rejectCode: (error: Error) => void = () => undefined
  let settled = false
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  codePromise.catch(() => undefined)

  const server: Server = createServer((request, response) => {
    const remoteAddress = request.socket.remoteAddress ?? ''
    if (!isLoopbackAddress(remoteAddress) || request.method !== 'GET') {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Forbidden')
      return
    }
    const redirectUri = currentRedirectUri(server)
    const callback = new URL(request.url ?? '/', `${redirectUri}/`)
    if (callback.pathname !== '/') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found')
      return
    }
    const state = callback.searchParams.get('state') ?? ''
    if (!safeStringEqual(state, expectedState)) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        .end('This authorization response could not be verified. Return to Mike Assist and try again.')
      return
    }
    const error = callback.searchParams.get('error')
    if (error) {
      settleError(new Error(error === 'access_denied' ? 'Google access was declined.' : 'Google OAuth returned an authorization error.'))
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        .end(successPage('Google access was not granted. You can return to Mike Assist.'))
      return
    }
    const code = callback.searchParams.get('code') ?? ''
    if (!code || code.length > 4_096) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        .end('The authorization response was incomplete. Return to Mike Assist and try again.')
      return
    }
    settled = true
    resolveCode(code)
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(successPage('Sign-in is complete. You can return to Mike Assist.'))
    server.close()
  })
  server.maxConnections = 4
  server.on('error', (error) => {
    if (!settled) {
      settled = true
      rejectCode(error)
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const redirectUri = currentRedirectUri(server)

  return {
    redirectUri,
    waitForCode(timeoutMs) {
      return Promise.race([
        codePromise,
        new Promise<string>((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Google sign-in timed out. Return to Settings and try again.')), timeoutMs)
          timer.unref?.()
          codePromise.finally(() => clearTimeout(timer)).catch(() => undefined)
        })
      ])
    },
    async close() {
      if (!settled) {
        settled = true
        rejectCode(new Error('Google sign-in was cancelled.'))
      }
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
      server.closeAllConnections()
    }
  }

  function settleError(error: Error): void {
    if (settled) return
    settled = true
    rejectCode(error)
    server.close()
  }
}

function currentRedirectUri(server: Server): string {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The Google sign-in listener is unavailable.')
  return `http://127.0.0.1:${address.port}`
}

function isLoopbackAddress(address: string): boolean {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1' || address === '::1'
}

function safeStringEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

function successPage(message: string): string {
  const text = message.replace(/[<>&"']/g, '')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mike Assist</title><body style="font:16px system-ui;margin:3rem auto;max-width:36rem;padding:0 1rem;color:#15202b"><h1>Mike Assist</h1><p>${text}</p></body></html>`
}

function friendlyOAuthError(error: unknown): Error {
  if (error instanceof Error && /declined|timed out|cancelled|Client ID|scope|PKCE|authorization URL|access/i.test(error.message)) {
    return error
  }
  return new Error('Google sign-in did not complete. Check the Desktop OAuth Client ID, enabled API, and consent-screen test-user settings, then try again.')
}
