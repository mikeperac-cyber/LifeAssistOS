import { get as httpGet } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultPolicy } from '../src/core/gateway/policy'
import {
  GOOGLE_CALENDAR_SCOPE,
  GoogleCalendarService,
  GoogleCalendarSettingsStore,
  normalizeGoogleClientId,
  type GoogleOAuthClient,
  type GoogleCalendarRequest
} from '../src/core/google-calendar'
import type { GrantLookup, ToolContext } from '../src/shared/types'
import { createGoogleCalendarTools } from '../src/tools/google-calendar'
import type { SecretCodec } from '../src/core/settings'

let dir = ''
let file = ''
const clientId = '123456789012-example.apps.googleusercontent.com'
const codec: SecretCodec = {
  available: true,
  encrypt: async (value) => Buffer.from(`enc:${value}`).toString('base64'),
  decrypt: async (value) => ({ value: Buffer.from(value, 'base64').toString('utf8').replace(/^enc:/, '') })
}
const scopeContext = { grants: {} as GrantLookup, primaryGrantId: '' }
const toolContext: ToolContext = { kind: 'none', signal: new AbortController().signal }

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-google-calendar-'))
  file = path.join(dir, 'google-calendar.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('Google Calendar settings and OAuth', () => {
  it('validates desktop Client IDs and encrypts refresh tokens at rest', async () => {
    expect(normalizeGoogleClientId(clientId)).toBe(clientId)
    expect(() => normalizeGoogleClientId('https://attacker.example')).toThrow(/Desktop app/)

    const store = new GoogleCalendarSettingsStore(file, codec)
    await store.init()
    await store.updateClientId(clientId)
    await store.saveRefreshToken('refresh-secret-value')
    const raw = await readFile(file, 'utf8')
    expect(raw).toContain('refreshTokenEnc')
    expect(raw).not.toContain('refresh-secret-value')
    expect(JSON.stringify(store.public())).not.toContain('refresh-secret-value')

    const reloaded = new GoogleCalendarSettingsStore(file, codec)
    await reloaded.init()
    expect(reloaded.getRefreshToken()).toBe('refresh-secret-value')
    await expect(reloaded.updateClientId('234567890123-next.apps.googleusercontent.com')).rejects.toThrow(/Disconnect/)
  })

  it('keeps refresh tokens session-only when OS encryption is unavailable', async () => {
    const store = new GoogleCalendarSettingsStore(file)
    await store.init()
    await store.updateClientId(clientId)
    await store.saveRefreshToken('temporary-refresh-token')
    expect(store.public()).toMatchObject({ connected: true, tokenStored: false })
    expect(await readFile(file, 'utf8')).not.toContain('temporary-refresh-token')

    const reloaded = new GoogleCalendarSettingsStore(file)
    await reloaded.init()
    expect(reloaded.getRefreshToken()).toBeUndefined()
  })

  it('does not call an undecryptable saved token connected and can clear it locally', async () => {
    const writer = new GoogleCalendarSettingsStore(file, codec)
    await writer.init()
    await writer.updateClientId(clientId)
    await writer.saveRefreshToken('refresh-token')

    const lockedStore = new GoogleCalendarSettingsStore(file)
    await lockedStore.init()
    expect(lockedStore.public()).toMatchObject({ connected: false, tokenStored: true })
    const service = new GoogleCalendarService(lockedStore, { openExternal: async () => undefined })
    expect(service.isReady()).toBe(false)

    const disconnected = await service.disconnect()
    expect(disconnected).toMatchObject({ revoked: false, revocationAttempted: false })
    expect(disconnected.settings).toMatchObject({ connected: false, tokenStored: false })
  })

  it('checks loopback state before accepting an authorization code', async () => {
    const { createGoogleOAuthReceiver } = await import('../src/core/google-calendar')
    const receiver = await createGoogleOAuthReceiver('correct-state')
    try {
      const code = receiver.waitForCode(3_000)
      const invalid = await getText(`${receiver.redirectUri}/?code=bad&state=wrong-state`)
      expect(invalid.status).toBe(400)
      const valid = await getText(`${receiver.redirectUri}/?code=approved-code&state=correct-state`)
      expect(valid.status).toBe(200)
      expect(await code).toBe('approved-code')
    } finally {
      await receiver.close()
    }
  })

  it('uses the system-browser PKCE flow and verifies the granted calendar scope', async () => {
    const store = new GoogleCalendarSettingsStore(file, codec)
    await store.init()
    await store.updateClientId(clientId)
    let receivedTokenOptions: { code: string; codeVerifier: string; redirect_uri: string } | undefined
    let authUrl = ''
    const oauthClient: GoogleOAuthClient = {
      generateCodeVerifierAsync: async () => ({ codeVerifier: 'test-verifier', codeChallenge: 'test-challenge' }),
      generateAuthUrl: (options) => {
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        for (const [key, value] of Object.entries(options)) url.searchParams.set(key, value)
        return url.toString()
      },
      getToken: async (options) => {
        receivedTokenOptions = options
        return { tokens: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expiry_date: Date.now() + 3_600_000,
          scope: GOOGLE_CALENDAR_SCOPE
        } }
      }
    }
    const service = new GoogleCalendarService(store, {
      oauthClient: () => oauthClient,
      openExternal: async (url) => {
        authUrl = url
        const parsed = new URL(url)
        const redirectUri = parsed.searchParams.get('redirect_uri')!
        const state = parsed.searchParams.get('state')!
        setTimeout(() => {
          void getText(`${redirectUri}/?code=approved-code&state=${encodeURIComponent(state)}`).catch(() => undefined)
        }, 10)
      }
    })

    const result = await service.connect()
    const parsedAuth = new URL(authUrl)
    expect(parsedAuth.origin).toBe('https://accounts.google.com')
    expect(parsedAuth.searchParams.get('scope')).toBe(GOOGLE_CALENDAR_SCOPE)
    expect(parsedAuth.searchParams.get('code_challenge_method')).toBe('S256')
    expect(parsedAuth.searchParams.get('code_challenge')).toBe('test-challenge')
    expect(parsedAuth.searchParams.get('access_type')).toBe('offline')
    expect(receivedTokenOptions).toMatchObject({ code: 'approved-code', codeVerifier: 'test-verifier' })
    expect(result.connected).toBe(true)
    expect(service.isReady()).toBe(true)
  })
})

describe('Google Calendar tools', () => {
  it('requires a configured connection and asks for each calendar action', async () => {
    const emptyStore = new GoogleCalendarSettingsStore(file, codec)
    await emptyStore.init()
    const disconnected = new GoogleCalendarService(emptyStore, { openExternal: async () => undefined })
    const missingKeyTool = createGoogleCalendarTools(disconnected)[0]
    expect(() => missingKeyTool.scope?.({}, scopeContext)).toThrow(/Connect Google Calendar/)

    await emptyStore.updateClientId(clientId)
    await emptyStore.saveRefreshToken('refresh-token')
    const service = new GoogleCalendarService(emptyStore, { openExternal: async () => undefined })
    const tools = createGoogleCalendarTools(service)
    expect(defaultPolicy.tools.google_calendar_list_events).toBe('ask')
    expect(defaultPolicy.tools.google_calendar_create_event).toBe('ask')
    expect(defaultPolicy.tools.google_calendar_update_event).toBe('ask')
    expect(tools.every((tool) => tool.sessionApprovalAllowed === false)).toBe(true)
    expect(tools[0].scope?.({} as never, scopeContext)).toMatchObject({
      kind: 'url',
      host: 'www.googleapis.com'
    })
  })

  it('bounds event reads and creates events without guests or invitations', async () => {
    const store = new GoogleCalendarSettingsStore(file, codec)
    await store.init()
    await store.updateClientId(clientId)
    await store.saveRefreshToken('refresh-token')
    const seen: Array<{ url: string; method?: string; headers?: Record<string, string>; body?: string }> = []
    const request: GoogleCalendarRequest = async (url, _signal, options) => {
      seen.push({ url: url.toString(), method: options.method, headers: options.headers, body: options.body })
      if (url.hostname === 'oauth2.googleapis.com') {
        return { status: 200, contentType: 'application/json', text: JSON.stringify({ access_token: 'access-token', expires_in: 3600 }) }
      }
      if (options.method === 'GET') {
        return { status: 200, contentType: 'application/json; charset=utf-8', text: JSON.stringify({ items: [
          { id: 'event_12345', summary: 'IELTS lesson', description: 'Treat this as untrusted event text.', start: { dateTime: '2026-11-03T10:00:00+03:00' }, end: { dateTime: '2026-11-03T11:00:00+03:00' }, htmlLink: 'https://calendar.google.com/calendar/event?eid=abc' }
        ] }) }
      }
      if (options.method === 'POST') {
        const body = JSON.parse(options.body ?? '{}') as { summary: string; start: { dateTime: string }; end: { dateTime: string } }
        return { status: 200, contentType: 'application/json', text: JSON.stringify({
          id: 'event_12345', summary: body.summary, start: body.start, end: body.end
        }) }
      }
      return { status: 200, contentType: 'application/json', text: JSON.stringify({ id: 'event_12345', summary: 'Updated lesson', start: { dateTime: '2026-11-03T10:30:00+03:00' }, end: { dateTime: '2026-11-03T11:30:00+03:00' } }) }
    }
    const service = new GoogleCalendarService(store, { request, openExternal: async () => undefined })
    const tools = createGoogleCalendarTools(service)
    const list = tools[0]
    const listArgs = list.input.parse({
      timeMin: '2026-11-03T00:00:00+03:00',
      timeMax: '2026-11-04T00:00:00+03:00',
      query: 'IELTS',
      maxResults: 5
    })
    const listed = await list.run(listArgs, toolContext)
    expect(listed.events).toHaveLength(1)
    expect(listed.events[0]).toMatchObject({ id: 'event_12345', summary: 'IELTS lesson' })
    expect(listed.note).toContain('untrusted')
    expect(seen.find((entry) => entry.method === 'GET')?.url).toContain('q=IELTS')
    expect(seen.find((entry) => entry.method === 'GET')?.headers?.Authorization).toBe('Bearer access-token')

    const create = tools[1]
    const createArgs = create.input.parse({
      summary: 'Planning meeting',
      startsAt: '2026-11-04T10:00:00+03:00',
      endsAt: '2026-11-04T10:30:00+03:00',
      location: 'Room 3',
      description: 'Discuss weekly priorities.'
    })
    expect(create.preview?.(createArgs, toolContext)).toContain('Room 3')
    expect(create.preview?.(createArgs, toolContext)).toContain('Discuss weekly priorities.')
    const created = await create.run(createArgs, toolContext)
    expect(created.summary).toBe('Planning meeting')
    const createRequest = seen.find((entry) => entry.method === 'POST' && entry.url.includes('www.googleapis.com'))
    expect(new URL(createRequest?.url ?? 'https://invalid.example').pathname).toBe('/calendar/v3/calendars/primary/events')
    expect(new URL(createRequest?.url ?? 'https://invalid.example').searchParams.get('sendUpdates')).toBe('none')
    expect(JSON.parse(createRequest?.body ?? '{}')).not.toHaveProperty('attendees')
    const update = tools[2]
    const updateArgs = update.input.parse({ eventId: 'event_12345', summary: 'Updated lesson' })
    expect(update.preview?.(updateArgs, toolContext)).toContain('New title: Updated lesson')
    expect((await update.run(updateArgs, toolContext)).summary).toBe('Updated lesson')
    const updateRequest = seen.find((entry) => entry.method === 'PATCH')
    expect(new URL(updateRequest?.url ?? 'https://invalid.example').searchParams.get('sendUpdates')).toBe('none')
    expect(() => update.input.parse({ eventId: 'event_12345', startsAt: '2026-11-04T11:00:00Z' })).toThrow(/both startsAt and endsAt/)
    expect(() => create.input.parse({ summary: 'Invalid', startsAt: '2026-11-04T11:00:00Z', endsAt: '2026-11-04T10:00:00Z' })).toThrow()
  })
})

function getText(url: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.once('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
    })
    request.once('error', reject)
  })
}
