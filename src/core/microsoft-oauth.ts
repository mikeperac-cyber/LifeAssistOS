import { z } from 'zod'
import { requestPinnedHttps, type PinnedHttpsRequestOptions, type ResponseBody } from '../tools/web'

const MICROSOFT_AUTH_ORIGIN = 'https://login.microsoftonline.com'
const MICROSOFT_DEVICE_CODE_URL = new URL('/common/oauth2/v2.0/devicecode', MICROSOFT_AUTH_ORIGIN)
const MICROSOFT_TOKEN_URL = new URL('/common/oauth2/v2.0/token', MICROSOFT_AUTH_ORIGIN)
const MICROSOFT_DEVICE_VERIFICATION_URI = 'https://microsoft.com/devicelogin'
const DEVICE_CODE_SCHEMA = z.object({
  device_code: z.string().min(1).max(8_192),
  user_code: z.string().min(4).max(32).regex(/^[A-Za-z0-9-]+$/),
  verification_uri: z.string().url().max(512),
  expires_in: z.number().int().min(30).max(3_600),
  interval: z.number().int().min(1).max(60).default(5)
})
const TOKEN_SCHEMA = z.object({
  access_token: z.string().min(1).max(8_192),
  expires_in: z.number().int().positive().max(86_400),
  refresh_token: z.string().min(1).max(8_192).optional()
})
const TOKEN_ERROR_SCHEMA = z.object({ error: z.string().max(128).optional() })

export interface MicrosoftTokenStore<PublicSettings> {
  getClientId(): string
  getRefreshToken(): string | undefined
  saveRefreshToken(refreshToken: string): Promise<void>
  clearConnection(): Promise<void>
  public(): PublicSettings
}

export interface MicrosoftConnectPrompt {
  userCode: string
  verificationUri: string
  expiresAt: number
}

export interface MicrosoftConnectStatus {
  phase: 'idle' | 'starting' | 'pending' | 'connected' | 'failed' | 'cancelled'
  prompt?: MicrosoftConnectPrompt
  error?: string
}

export type MicrosoftRequest = (
  url: URL,
  signal: AbortSignal,
  options: PinnedHttpsRequestOptions
) => Promise<ResponseBody>
export type MicrosoftWait = (milliseconds: number, signal: AbortSignal) => Promise<void>

export interface MicrosoftOAuthOptions {
  scopes: string
  serviceName: string
  request?: MicrosoftRequest
  openExternal: (url: string) => Promise<void>
  wait?: MicrosoftWait
  onConnected?: () => Promise<unknown>
}

interface ConnectAttempt {
  controller: AbortController
  status: MicrosoftConnectStatus
  polling?: Promise<void>
}

/** Separate, cancellable device-code OAuth state for one Microsoft Graph connector. */
export class MicrosoftOAuthConnection<PublicSettings> {
  private readonly request: MicrosoftRequest
  private readonly wait: MicrosoftWait
  private accessToken = ''
  private accessTokenExpiresAt = 0
  private tokenGeneration = 0
  private refreshInFlight: Promise<string> | null = null
  private connectAttempt: ConnectAttempt | null = null

  constructor(
    private readonly store: MicrosoftTokenStore<PublicSettings>,
    private readonly options: MicrosoftOAuthOptions
  ) {
    this.request = options.request ?? requestPinnedHttps
    this.wait = options.wait ?? waitFor
  }

  isReady(): boolean { return Boolean(this.store.getClientId() && this.store.getRefreshToken()) }
  isConnecting(): boolean { return this.connectAttempt?.status.phase === 'starting' || this.connectAttempt?.status.phase === 'pending' }

  connectStatus(): MicrosoftConnectStatus {
    const status = this.connectAttempt?.status
    return status ? structuredClone(status) : { phase: 'idle' }
  }

  clearCachedAccessToken(): void {
    this.tokenGeneration += 1
    this.accessToken = ''
    this.accessTokenExpiresAt = 0
    this.refreshInFlight = null
  }

  async beginConnect(): Promise<MicrosoftConnectPrompt> {
    if (this.isConnecting()) throw new Error(`A ${this.options.serviceName} sign-in is already in progress.`)
    const previousPolling = this.connectAttempt?.polling
    if (previousPolling) await previousPolling
    if (this.isConnecting()) throw new Error(`A ${this.options.serviceName} sign-in is already in progress.`)
    if (this.isReady()) throw new Error(`${this.options.serviceName} is already connected. Disconnect it before starting another sign-in.`)
    const clientId = this.store.getClientId()
    if (!clientId) throw new Error('Save a Microsoft Entra Application (client) ID in Settings first.')
    const attempt: ConnectAttempt = { controller: new AbortController(), status: { phase: 'starting' } }
    this.connectAttempt = attempt
    try {
      const device = await this.requestDeviceCode(clientId, attempt.controller.signal)
      if (attempt.controller.signal.aborted || this.connectAttempt !== attempt) throw new Error('Sign-in was cancelled.')
      const prompt: MicrosoftConnectPrompt = {
        userCode: device.user_code,
        verificationUri: MICROSOFT_DEVICE_VERIFICATION_URI,
        expiresAt: Date.now() + device.expires_in * 1_000
      }
      attempt.status = { phase: 'pending', prompt }
      attempt.polling = this.pollForTokens(clientId, device.device_code, device.expires_in, device.interval, attempt)
        .then(async (tokens) => {
          if (attempt.controller.signal.aborted || this.connectAttempt !== attempt) {
            throw new Error('Sign-in was cancelled.')
          }
          await this.store.saveRefreshToken(tokens.refresh_token!)
          if (attempt.controller.signal.aborted || this.connectAttempt !== attempt) {
            await this.store.clearConnection()
            throw new Error('Sign-in was cancelled.')
          }
          this.accessToken = tokens.access_token
          this.accessTokenExpiresAt = Date.now() + tokens.expires_in * 1_000
          attempt.status = { phase: 'connected' }
          try { await this.options.onConnected?.() }
          catch (error) { console.warn(`[${this.options.serviceName.toLowerCase()}] connected but could not append the audit event`, error) }
        })
        .catch((error: unknown) => {
          attempt.status = attempt.controller.signal.aborted
            ? { phase: 'cancelled' }
            : { phase: 'failed', error: safeConnectError(error) }
        })
      void this.options.openExternal(MICROSOFT_DEVICE_VERIFICATION_URI).catch(() => undefined)
      return prompt
    } catch (error) {
      attempt.status = attempt.controller.signal.aborted
        ? { phase: 'cancelled' }
        : { phase: 'failed', error: safeConnectError(error) }
      throw new Error(attempt.status.error ?? `${this.options.serviceName} sign-in was cancelled.`)
    }
  }

  async cancelConnect(): Promise<MicrosoftConnectStatus> {
    const attempt = this.connectAttempt
    if (attempt && (attempt.status.phase === 'starting' || attempt.status.phase === 'pending')) {
      attempt.controller.abort()
      attempt.status = { phase: 'cancelled' }
      await attempt.polling?.catch(() => undefined)
    }
    return this.connectStatus()
  }

  async disconnect(): Promise<PublicSettings> {
    await this.cancelConnect()
    await this.store.clearConnection()
    this.clearCachedAccessToken()
    return this.store.public()
  }

  async getAccessToken(signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new Error(`${this.options.serviceName} request was cancelled.`)
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) return this.accessToken
    if (this.refreshInFlight) return this.refreshInFlight
    const clientId = this.store.getClientId()
    const refreshToken = this.store.getRefreshToken()
    if (!clientId || !refreshToken) throw new Error(`Connect ${this.options.serviceName} in Settings before using it.`)
    const generation = this.tokenGeneration
    const refresh = this.refreshAccessToken(clientId, refreshToken, signal, generation)
    this.refreshInFlight = refresh
    try { return await refresh }
    finally { if (this.refreshInFlight === refresh) this.refreshInFlight = null }
  }

  private async requestDeviceCode(clientId: string, signal: AbortSignal): Promise<z.infer<typeof DEVICE_CODE_SCHEMA>> {
    const response = await this.request(MICROSOFT_DEVICE_CODE_URL, signal, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: clientId, scope: this.options.scopes }).toString(),
      maxResponseBytes: 64_000, timeoutMs: 10_000
    })
    if (response.status < 200 || response.status >= 300) throw new Error(mapAuthError(parseAuthError(response.text), this.options.serviceName))
    const parsed = DEVICE_CODE_SCHEMA.safeParse(parseJson(response.text, 'device-code response'))
    if (!parsed.success || !isDeviceVerificationUri(parsed.data.verification_uri)) {
      throw new Error('Microsoft returned an unexpected sign-in response.')
    }
    validateSecret(parsed.data.device_code, 'Microsoft returned an invalid device code.')
    return parsed.data
  }

  private async pollForTokens(
    clientId: string,
    deviceCode: string,
    expiresIn: number,
    initialInterval: number,
    attempt: ConnectAttempt
  ): Promise<z.infer<typeof TOKEN_SCHEMA> & { refresh_token: string }> {
    const deadline = Date.now() + expiresIn * 1_000
    let interval = initialInterval
    while (Date.now() < deadline) {
      await this.wait(interval * 1_000, attempt.controller.signal)
      const response = await this.request(MICROSOFT_TOKEN_URL, attempt.controller.signal, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode
        }).toString(),
        maxResponseBytes: 64_000, timeoutMs: 10_000
      })
      if (response.status >= 200 && response.status < 300) {
        const parsed = TOKEN_SCHEMA.safeParse(parseJson(response.text, 'token response'))
        if (!parsed.success || !parsed.data.refresh_token) {
          throw new Error('Microsoft did not return a refresh token. Check that offline_access is enabled for this app registration.')
        }
        validateSecret(parsed.data.access_token, 'Microsoft returned an invalid access token.')
        validateSecret(parsed.data.refresh_token, 'Microsoft returned an invalid refresh token.')
        return parsed.data as z.infer<typeof TOKEN_SCHEMA> & { refresh_token: string }
      }
      const code = parseAuthError(response.text)
      if (code === 'authorization_pending') continue
      if (code === 'slow_down') { interval = Math.min(interval + 5, 60); continue }
      throw new Error(mapAuthError(code, this.options.serviceName))
    }
    throw new Error('Microsoft sign-in code expired. Start the connection again.')
  }

  private async refreshAccessToken(clientId: string, refreshToken: string, signal: AbortSignal, generation: number): Promise<string> {
    let response: ResponseBody
    try {
      response = await this.request(MICROSOFT_TOKEN_URL, signal, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: this.options.scopes
        }).toString(),
        maxResponseBytes: 64_000, timeoutMs: 10_000
      })
    } catch {
      throw new Error(`Could not refresh the ${this.options.serviceName} connection. Check your internet connection and try again.`)
    }
    if (generation !== this.tokenGeneration || signal.aborted) {
      throw new Error(`The ${this.options.serviceName} connection changed while refreshing access.`)
    }
    if (response.status < 200 || response.status >= 300) {
      const code = parseAuthError(response.text)
      if (code === 'invalid_grant' || response.status === 401) {
        await this.store.clearConnection()
        this.clearCachedAccessToken()
        throw new Error(`${this.options.serviceName} access expired or was revoked. Reconnect it in Settings.`)
      }
      throw new Error(`Microsoft could not refresh the ${this.options.serviceName} connection (HTTP ${response.status}).`)
    }
    const parsed = TOKEN_SCHEMA.safeParse(parseJson(response.text, 'token response'))
    if (!parsed.success) throw new Error('Microsoft returned an unexpected token response.')
    validateSecret(parsed.data.access_token, 'Microsoft returned an invalid access token.')
    if (generation !== this.tokenGeneration || signal.aborted) {
      throw new Error(`The ${this.options.serviceName} connection changed while refreshing access.`)
    }
    if (parsed.data.refresh_token) await this.store.saveRefreshToken(parsed.data.refresh_token)
    if (generation !== this.tokenGeneration || signal.aborted) {
      throw new Error(`The ${this.options.serviceName} connection changed while refreshing access.`)
    }
    this.accessToken = parsed.data.access_token
    this.accessTokenExpiresAt = Date.now() + parsed.data.expires_in * 1_000
    return this.accessToken
  }
}

function validateSecret(value: string, message: string): void {
  if (!value || value.length > 8_192 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(message)
}

function isDeviceVerificationUri(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'microsoft.com' && url.pathname === '/devicelogin' &&
      !url.port && !url.username && !url.password && !url.search && !url.hash
  } catch { return false }
}

function parseJson(text: string, what: string): unknown {
  try { return JSON.parse(text) as unknown } catch { throw new Error(`Microsoft returned an unreadable ${what}.`) }
}

function parseAuthError(text: string): string {
  const parsed = TOKEN_ERROR_SCHEMA.safeParse(parseJson(text, 'authentication response'))
  return parsed.success ? parsed.data.error ?? '' : ''
}

function mapAuthError(code: string, serviceName: string): string {
  switch (code) {
    case 'authorization_pending': return 'Microsoft sign-in is still waiting for your approval.'
    case 'authorization_declined':
    case 'access_denied': return 'Microsoft sign-in was declined.'
    case 'expired_token': return 'Microsoft sign-in code expired. Start the connection again.'
    case 'invalid_client':
    case 'unauthorized_client': return 'Microsoft rejected this client ID. Check the app registration and allow public-client flows.'
    case 'invalid_scope': return `Microsoft rejected the requested ${serviceName} permission. Check the app registration.`
    case 'invalid_grant': return `${serviceName} access expired or was revoked. Reconnect it in Settings.`
    case 'slow_down': return 'Microsoft sign-in requested a slower polling interval.'
    default: return 'Microsoft sign-in failed. Check the app registration, requested permissions, and internet connection.'
  }
}

function safeConnectError(error: unknown): string {
  return error instanceof Error ? error.message : 'Microsoft sign-in failed. Try again.'
}

function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Sign-in was cancelled.'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve() }, milliseconds)
    const onAbort = (): void => { clearTimeout(timer); cleanup(); reject(new Error('Sign-in was cancelled.')) }
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
