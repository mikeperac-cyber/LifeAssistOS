import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { SecretCodec } from './settings'
import { authorizeGoogleDesktop, normalizeGoogleClientId, type GoogleOAuthClient } from './google-oauth'
import { requestPinnedHttps, type PinnedHttpsRequestOptions, type ResponseBody } from '../tools/web'

export const GOOGLE_GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose'
] as const

const GOOGLE_TOKEN_URL = new URL('https://oauth2.googleapis.com/token')
const GOOGLE_REVOKE_URL = new URL('https://oauth2.googleapis.com/revoke')
const GMAIL_HOST = 'gmail.googleapis.com'
const GMAIL_API_ROOT = '/gmail/v1/users/me'
const GMAIL_TOKEN_SCHEMA = z.object({
  access_token: z.string().min(1).max(8_192),
  expires_in: z.number().int().positive().max(86_400),
  refresh_token: z.string().min(1).max(8_192).optional(),
  error: z.string().optional()
})

interface GoogleGmailSettingsFile {
  version: 1
  clientId: string
  refreshTokenEnc?: string
}

export interface PublicGoogleGmailSettings {
  clientId: string
  connected: boolean
  tokenStored: boolean
}

/** Keeps the Gmail refresh token outside renderer state and encrypted when OS storage is available. */
export class GoogleGmailSettingsStore {
  private clientId = ''
  private refreshToken = ''
  private storedRefreshTokenEnc?: string

  constructor(private readonly file: string, private readonly codec?: SecretCodec) {}

  async init(): Promise<void> {
    this.clientId = ''
    this.refreshToken = ''
    this.storedRefreshTokenEnc = undefined
    await mkdir(path.dirname(this.file), { recursive: true })
    try {
      const loaded = JSON.parse(await readFile(this.file, 'utf8')) as Partial<GoogleGmailSettingsFile>
      if (loaded.version === 1) {
        if (typeof loaded.clientId === 'string') {
          try { this.clientId = normalizeGoogleClientId(loaded.clientId, true) } catch { this.clientId = '' }
        }
        if (typeof loaded.refreshTokenEnc === 'string' && loaded.refreshTokenEnc.length > 0) {
          this.storedRefreshTokenEnc = loaded.refreshTokenEnc
          if (this.codec?.available) {
            try {
              this.refreshToken = (await this.codec.decrypt(loaded.refreshTokenEnc)).value
            } catch (error) {
              console.warn('[google-gmail] could not decrypt the stored token; preserving its ciphertext', error)
            }
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[google-gmail] could not read settings file', error)
      }
    }
    await this.persist()
  }

  public(): PublicGoogleGmailSettings {
    return {
      clientId: this.clientId,
      connected: Boolean(this.clientId && this.refreshToken),
      tokenStored: Boolean(this.storedRefreshTokenEnc)
    }
  }

  getClientId(): string { return this.clientId }
  getRefreshToken(): string | undefined { return this.refreshToken || undefined }
  hasStoredRefreshToken(): boolean { return Boolean(this.refreshToken || this.storedRefreshTokenEnc) }

  async updateClientId(input: string): Promise<PublicGoogleGmailSettings> {
    const value = normalizeGoogleClientId(input, true)
    if (this.hasStoredRefreshToken() && value !== this.clientId) {
      throw new Error('Disconnect Gmail before changing its OAuth Client ID.')
    }
    this.clientId = value
    await this.persist()
    return this.public()
  }

  async saveRefreshToken(refreshToken: string): Promise<void> {
    if (!refreshToken || refreshToken.length > 8_192 || /[\u0000-\u001f\u007f]/.test(refreshToken)) {
      throw new Error('Google returned an invalid refresh token.')
    }
    this.refreshToken = refreshToken
    this.storedRefreshTokenEnc = undefined
    await this.persist()
  }

  async clearConnection(): Promise<void> {
    this.refreshToken = ''
    this.storedRefreshTokenEnc = undefined
    await this.persist()
  }

  private async persist(): Promise<void> {
    if (this.refreshToken && this.codec?.available) {
      this.storedRefreshTokenEnc = await this.codec.encrypt(this.refreshToken)
    }
    const payload: GoogleGmailSettingsFile = {
      version: 1,
      clientId: this.clientId,
      ...(this.storedRefreshTokenEnc ? { refreshTokenEnc: this.storedRefreshTokenEnc } : {})
    }
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(temporary, this.file)
  }
}

export type GmailRequest = (
  url: URL,
  signal: AbortSignal,
  options: PinnedHttpsRequestOptions
) => Promise<ResponseBody>

export interface GoogleGmailServiceOptions {
  request?: GmailRequest
  oauthClient?: (clientId: string) => GoogleOAuthClient
  openExternal: (url: string) => Promise<void>
}

/** OAuth and fixed-host Gmail REST operations used by permission-gated tools. */
export class GoogleGmailService {
  private readonly request: GmailRequest
  private accessToken = ''
  private accessTokenExpiresAt = 0

  constructor(
    private readonly store: GoogleGmailSettingsStore,
    private readonly options: GoogleGmailServiceOptions
  ) {
    this.request = options.request ?? requestPinnedHttps
  }

  isReady(): boolean {
    return Boolean(this.store.getClientId() && this.store.getRefreshToken())
  }

  clearCachedAccessToken(): void {
    this.accessToken = ''
    this.accessTokenExpiresAt = 0
  }

  async connect(): Promise<PublicGoogleGmailSettings> {
    const clientId = this.store.getClientId()
    if (!clientId) throw new Error('Save a Google OAuth Desktop Client ID in Settings first.')
    const tokens = await authorizeGoogleDesktop({
      clientId,
      scopes: [...GOOGLE_GMAIL_SCOPES],
      permissionLabel: 'Gmail',
      openExternal: this.options.openExternal,
      oauthClient: this.options.oauthClient
    })
    await this.store.saveRefreshToken(tokens.refresh_token)
    this.accessToken = tokens.access_token
    this.accessTokenExpiresAt = tokens.expiry_date ?? Date.now() + 3_600_000
    return this.store.public()
  }

  async disconnect(signal?: AbortSignal): Promise<{
    revoked: boolean
    revocationAttempted: boolean
    settings: PublicGoogleGmailSettings
  }> {
    const refreshToken = this.store.getRefreshToken()
    const hadStoredToken = this.store.hasStoredRefreshToken()
    let revoked = !hadStoredToken
    const revocationAttempted = Boolean(refreshToken)
    if (refreshToken) {
      try {
        const response = await this.request(GOOGLE_REVOKE_URL, signal ?? new AbortController().signal, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ token: refreshToken }).toString(),
          maxResponseBytes: 64_000,
          timeoutMs: 10_000
        })
        revoked = response.status >= 200 && response.status < 300
      } catch {
        revoked = false
      }
    }
    await this.store.clearConnection()
    this.accessToken = ''
    this.accessTokenExpiresAt = 0
    return { revoked, revocationAttempted, settings: this.store.public() }
  }

  async requestGmailApi(
    url: URL,
    method: 'GET' | 'POST',
    signal: AbortSignal,
    body?: string,
    maxResponseBytes = 512_000
  ): Promise<ResponseBody> {
    if (!isAllowedGmailApiRequest(url, method)) {
      throw new Error('Gmail requests are limited to supported operations on the fixed Google Gmail API host.')
    }
    const makeRequest = async (token: string): Promise<ResponseBody> => this.request(url, signal, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body,
      maxResponseBytes,
      timeoutMs: 12_000
    })

    let response = await makeRequest(await this.getAccessToken(signal))
    if (response.status === 401) {
      this.accessToken = ''
      this.accessTokenExpiresAt = 0
      response = await makeRequest(await this.getAccessToken(signal))
    }
    return response
  }

  private async getAccessToken(signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new Error('The Gmail request was cancelled.')
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) return this.accessToken
    const clientId = this.store.getClientId()
    const refreshToken = this.store.getRefreshToken()
    if (!clientId || !refreshToken) {
      throw new Error('Connect Gmail in Settings before asking the assistant to use it.')
    }

    let response: ResponseBody
    try {
      response = await this.request(GOOGLE_TOKEN_URL, signal, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: clientId, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
        maxResponseBytes: 64_000,
        timeoutMs: 10_000
      })
    } catch {
      throw new Error('Could not refresh the Gmail connection. Check your internet connection and try again.')
    }
    if (response.status === 400 || response.status === 401) {
      await this.store.clearConnection()
      this.accessToken = ''
      this.accessTokenExpiresAt = 0
      throw new Error('Gmail access expired or was revoked. Reconnect it in Settings.')
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Google token refresh returned HTTP ${response.status}.`)
    }
    const parsed = parseTokenResponse(response.text)
    this.accessToken = parsed.access_token
    this.accessTokenExpiresAt = Date.now() + parsed.expires_in * 1000
    if (parsed.refresh_token) await this.store.saveRefreshToken(parsed.refresh_token)
    return this.accessToken
  }
}

export function isAllowedGmailApiRequest(url: URL, method: string): boolean {
  if (
    url.origin !== `https://${GMAIL_HOST}` || url.username || url.password || url.port || url.hash
  ) return false

  const root = `${GMAIL_API_ROOT}/`
  if (!url.pathname.startsWith(root)) return false
  const resource = url.pathname.slice(root.length)
  if (method === 'GET') {
    return resource === 'messages' || /^messages\/(?!send$)[A-Za-z0-9_-]{1,256}$/.test(resource)
  }
  return resource === 'drafts' || resource === 'messages/send'
}

function parseTokenResponse(text: string): z.infer<typeof GMAIL_TOKEN_SCHEMA> {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('Google returned an unreadable token response.') }
  const parsed = GMAIL_TOKEN_SCHEMA.safeParse(raw)
  if (!parsed.success) throw new Error('Google returned an unexpected token response.')
  return parsed.data
}
