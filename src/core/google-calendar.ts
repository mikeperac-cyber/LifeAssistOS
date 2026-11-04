import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { SecretCodec } from './settings'
import { authorizeGoogleDesktop, normalizeGoogleClientId, type GoogleOAuthClient } from './google-oauth'
export { createGoogleOAuthReceiver, normalizeGoogleClientId } from './google-oauth'
export type { GoogleOAuthClient, GoogleOAuthTokens, OAuthVerifier } from './google-oauth'
import { requestPinnedHttps, type PinnedHttpsRequestOptions, type ResponseBody } from '../tools/web'

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned'
const GOOGLE_TOKEN_URL = new URL('https://oauth2.googleapis.com/token')
const GOOGLE_REVOKE_URL = new URL('https://oauth2.googleapis.com/revoke')
const GOOGLE_CALENDAR_HOST = 'www.googleapis.com'
const GOOGLE_API_PREFIX = '/calendar/v3/calendars/primary/events'
const GOOGLE_TOKEN_SCHEMA = z.object({
  access_token: z.string().min(1).max(8_192),
  expires_in: z.number().int().positive().max(86_400),
  refresh_token: z.string().min(1).max(8_192).optional(),
  error: z.string().optional()
})

interface GoogleCalendarSettingsFile {
  version: 1
  clientId: string
  refreshTokenEnc?: string
}

interface GoogleCalendarStoreState {
  clientId: string
  refreshToken: string
  storedRefreshTokenEnc?: string
}

export interface PublicGoogleCalendarSettings {
  clientId: string
  connected: boolean
  tokenStored: boolean
}

/** Keeps the user-owned Google OAuth refresh token outside renderer state. */
export class GoogleCalendarSettingsStore {
  private clientId = ''
  private refreshToken = ''
  private storedRefreshTokenEnc?: string
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly file: string, private readonly codec?: SecretCodec) {}

  async init(): Promise<void> {
    await this.mutate(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      let next: GoogleCalendarStoreState = { clientId: '', refreshToken: '' }
      try {
        const loaded = JSON.parse(await readFile(this.file, 'utf8')) as Partial<GoogleCalendarSettingsFile>
        if (loaded.version === 1) {
          if (typeof loaded.clientId === 'string') {
            try {
              next.clientId = normalizeGoogleClientId(loaded.clientId, true)
            } catch {
              next.clientId = ''
            }
          }
          if (typeof loaded.refreshTokenEnc === 'string' && loaded.refreshTokenEnc.length > 0) {
            next.storedRefreshTokenEnc = loaded.refreshTokenEnc
            if (this.codec?.available) {
              try {
                next.refreshToken = (await this.codec.decrypt(loaded.refreshTokenEnc)).value
              } catch (error) {
                console.warn('[google-calendar] could not decrypt the stored token; preserving its ciphertext', error)
              }
            }
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('[google-calendar] could not read settings file', error)
        }
      }
      this.apply(await this.persist(next))
    })
  }

  public(): PublicGoogleCalendarSettings {
    return {
      clientId: this.clientId,
      // A ciphertext that exists on disk is not a usable connection until the
      // OS key store can decrypt it. Keep that distinction visible to callers.
      connected: Boolean(this.clientId && this.refreshToken),
      tokenStored: Boolean(this.storedRefreshTokenEnc)
    }
  }

  getClientId(): string {
    return this.clientId
  }

  getRefreshToken(): string | undefined {
    return this.refreshToken || undefined
  }

  hasStoredRefreshToken(): boolean {
    return Boolean(this.refreshToken || this.storedRefreshTokenEnc)
  }

  async updateClientId(input: string): Promise<PublicGoogleCalendarSettings> {
    return this.mutate(async () => {
      const value = normalizeGoogleClientId(input, true)
      if (this.hasStoredRefreshToken() && value !== this.clientId) {
        throw new Error('Disconnect Google Calendar before changing its OAuth Client ID.')
      }
      this.apply(await this.persist({ ...this.snapshot(), clientId: value }))
      return this.public()
    })
  }

  async saveRefreshToken(refreshToken: string): Promise<void> {
    if (!refreshToken || refreshToken.length > 8_192 || /[\u0000-\u001f\u007f]/.test(refreshToken)) {
      throw new Error('Google returned an invalid refresh token.')
    }
    await this.mutate(async () => {
      this.apply(await this.persist({ ...this.snapshot(), refreshToken, storedRefreshTokenEnc: undefined }))
    })
  }

  async clearConnection(): Promise<void> {
    await this.mutate(async () => {
      this.apply(await this.persist({ ...this.snapshot(), refreshToken: '', storedRefreshTokenEnc: undefined }))
    })
  }

  private snapshot(): GoogleCalendarStoreState {
    return { clientId: this.clientId, refreshToken: this.refreshToken, storedRefreshTokenEnc: this.storedRefreshTokenEnc }
  }

  private apply(state: GoogleCalendarStoreState): void {
    this.clientId = state.clientId
    this.refreshToken = state.refreshToken
    this.storedRefreshTokenEnc = state.storedRefreshTokenEnc
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async persist(state: GoogleCalendarStoreState): Promise<GoogleCalendarStoreState> {
    const storedRefreshTokenEnc = state.refreshToken && this.codec?.available
      ? await this.codec.encrypt(state.refreshToken)
      : state.storedRefreshTokenEnc
    const payload: GoogleCalendarSettingsFile = {
      version: 1,
      clientId: state.clientId,
      ...(storedRefreshTokenEnc ? { refreshTokenEnc: storedRefreshTokenEnc } : {})
    }
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      await rename(temporary, this.file)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
    return { ...state, storedRefreshTokenEnc }
  }
}

export type GoogleCalendarRequest = (
  url: URL,
  signal: AbortSignal,
  options: PinnedHttpsRequestOptions
) => Promise<ResponseBody>

export interface GoogleCalendarServiceOptions {
  request?: GoogleCalendarRequest
  oauthClient?: (clientId: string) => GoogleOAuthClient
  openExternal: (url: string) => Promise<void>
}

/** OAuth and fixed-host Calendar API operations used by permission-gated tools. */
export class GoogleCalendarService {
  private readonly request: GoogleCalendarRequest
  private accessToken = ''
  private accessTokenExpiresAt = 0

  constructor(
    private readonly store: GoogleCalendarSettingsStore,
    private readonly options: GoogleCalendarServiceOptions
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

  async connect(): Promise<PublicGoogleCalendarSettings> {
    const clientId = this.store.getClientId()
    if (!clientId) throw new Error('Save a Google OAuth Desktop Client ID in Settings first.')
    const tokens = await authorizeGoogleDesktop({
      clientId,
      scopes: [GOOGLE_CALENDAR_SCOPE],
      permissionLabel: 'Calendar event',
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
    settings: PublicGoogleCalendarSettings
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

  async requestCalendarApi(url: URL, method: 'GET' | 'POST' | 'PATCH', signal: AbortSignal, body?: string): Promise<ResponseBody> {
    if (
      url.origin !== `https://${GOOGLE_CALENDAR_HOST}` ||
      url.username || url.password || url.port ||
      (url.pathname !== GOOGLE_API_PREFIX && !url.pathname.startsWith(`${GOOGLE_API_PREFIX}/`))
    ) {
      throw new Error('Calendar requests are limited to the fixed Google Calendar API host.')
    }
    const makeRequest = async (token: string): Promise<ResponseBody> => this.request(url, signal, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body,
      maxResponseBytes: 512_000,
      timeoutMs: 12_000,
      outcomeUnknownOnFailure: method !== 'GET'
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
    if (signal.aborted) throw new Error('The Calendar request was cancelled.')
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) return this.accessToken

    const clientId = this.store.getClientId()
    const refreshToken = this.store.getRefreshToken()
    if (!clientId || !refreshToken) {
      throw new Error('Connect Google Calendar in Settings before asking the assistant to use it.')
    }
    let response: ResponseBody
    try {
      response = await this.request(GOOGLE_TOKEN_URL, signal, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: clientId,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        }).toString(),
        maxResponseBytes: 64_000,
        timeoutMs: 10_000
      })
    } catch {
      throw new Error('Could not refresh the Google Calendar connection. Check your internet connection and try again.')
    }
    if (response.status === 400 || response.status === 401) {
      await this.store.clearConnection()
      this.accessToken = ''
      this.accessTokenExpiresAt = 0
      throw new Error('Google Calendar access expired or was revoked. Reconnect it in Settings.')
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Google token refresh returned HTTP ${response.status}.`)
    }
    const parsed = parseGoogleTokenResponse(response.text)
    if (parsed.refresh_token) await this.store.saveRefreshToken(parsed.refresh_token)
    this.accessToken = parsed.access_token
    this.accessTokenExpiresAt = Date.now() + parsed.expires_in * 1000
    return this.accessToken
  }
}

function parseGoogleTokenResponse(text: string): z.infer<typeof GOOGLE_TOKEN_SCHEMA> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Google returned an unreadable token response.')
  }
  const parsed = GOOGLE_TOKEN_SCHEMA.safeParse(raw)
  if (!parsed.success) throw new Error('Google returned an unexpected token response.')
  return parsed.data
}
