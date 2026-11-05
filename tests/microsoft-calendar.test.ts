import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MICROSOFT_CALENDAR_SCOPES,
  MicrosoftCalendarService,
  MicrosoftCalendarSettingsStore,
  isAllowedMicrosoftCalendarApiRequest,
  type MicrosoftCalendarRequest
} from '../src/core/microsoft-calendar'
import type { SecretCodec } from '../src/core/settings'
import { defaultPolicy } from '../src/core/gateway/policy'
import { createMicrosoftCalendarTools } from '../src/tools/microsoft-calendar'

let dir = ''
let file = ''
const clientId = '11111111-1111-4111-8111-111111111111'
const codec: SecretCodec = {
  available: true,
  encrypt: async (value) => Buffer.from(`enc:${value}`).toString('base64'),
  decrypt: async (value) => ({ value: Buffer.from(value, 'base64').toString('utf8').replace(/^enc:/, '') })
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-microsoft-calendar-'))
  file = path.join(dir, 'microsoft-calendar.json')
})

afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function response(text: string, status = 200) {
  return { status, contentType: 'application/json', text }
}

const tokenResponse = (accessToken = 'graph-access') => response(JSON.stringify({ access_token: accessToken, expires_in: 3600 }))

async function configuredStore(): Promise<MicrosoftCalendarSettingsStore> {
  const store = new MicrosoftCalendarSettingsStore(file, codec)
  await store.init()
  await store.updateClientId(clientId)
  return store
}

async function connectedStore(): Promise<MicrosoftCalendarSettingsStore> {
  const store = await configuredStore()
  await store.saveRefreshToken('microsoft-calendar-refresh-secret')
  return store
}

describe('Outlook Calendar settings and device-code sign-in', () => {
  it('encrypts refresh tokens and preserves locked ciphertext for later recovery', async () => {
    await connectedStore()
    const raw = await readFile(file, 'utf8')
    expect(raw).toContain('refreshTokenEnc')
    expect(raw).not.toContain('microsoft-calendar-refresh-secret')

    const locked = new MicrosoftCalendarSettingsStore(file)
    await locked.init()
    expect(locked.public()).toMatchObject({ connected: false, tokenStored: true, clientId })
    await locked.clearConnection()
    expect(locked.public()).toMatchObject({ connected: false, tokenStored: false })
  })

  it('validates Application IDs and will not replace the ID beneath a saved token', async () => {
    const store = await configuredStore()
    await expect(store.updateClientId('not-a-guid')).rejects.toThrow(/Application \(client\) ID/i)
    await store.saveRefreshToken('microsoft-calendar-refresh-secret')
    await expect(store.updateClientId('22222222-2222-4222-8222-222222222222')).rejects.toThrow(/clear the saved/i)
  })

  it('uses device-code flow with a separate Calendars.ReadBasic grant and never exposes the device code', async () => {
    const store = await configuredStore()
    const seen: Array<{ url: URL; body: URLSearchParams }> = []
    const request: MicrosoftCalendarRequest = async (url, _signal, options) => {
      seen.push({ url, body: new URLSearchParams(options.body) })
      if (url.pathname.endsWith('/devicecode')) return response(JSON.stringify({
        device_code: 'secret-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 1
      }))
      return response(JSON.stringify({ access_token: 'graph-access', refresh_token: 'microsoft-calendar-refresh-secret', expires_in: 3600 }))
    }
    const openExternal = vi.fn(async () => undefined)
    const service = new MicrosoftCalendarService(store, { request, openExternal, wait: async () => undefined })
    const prompt = await service.beginConnect()
    await vi.waitFor(() => expect(service.connectStatus().phase).toBe('connected'))

    expect(seen[0]?.url.toString()).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/devicecode')
    expect(seen[0]?.body.get('client_id')).toBe(clientId)
    expect(seen[0]?.body.get('scope')).toBe(MICROSOFT_CALENDAR_SCOPES)
    expect(MICROSOFT_CALENDAR_SCOPES).toBe('Calendars.ReadBasic offline_access')
    expect(prompt).toMatchObject({ userCode: 'ABCD-EFGH', verificationUri: 'https://microsoft.com/devicelogin' })
    expect(JSON.stringify(prompt)).not.toContain('secret-device-code')
    expect(openExternal).toHaveBeenCalledWith('https://microsoft.com/devicelogin')
    expect(store.public()).toMatchObject({ connected: true, tokenStored: true })
  })

  it('cancels sign-in and does not persist a late token response', async () => {
    const store = await configuredStore()
    let finishToken!: (value: ReturnType<typeof response>) => void
    const token = new Promise<ReturnType<typeof response>>((resolve) => { finishToken = resolve })
    const request: MicrosoftCalendarRequest = async (url) => url.pathname.endsWith('/devicecode')
      ? response(JSON.stringify({ device_code: 'secret-code', user_code: 'WXYZ-1234', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 1 }))
      : token
    const service = new MicrosoftCalendarService(store, { request, openExternal: async () => undefined, wait: async () => undefined })
    await service.beginConnect()
    await vi.waitFor(() => expect(finishToken).toBeTypeOf('function'))
    const cancelled = service.cancelConnect()
    finishToken(response(JSON.stringify({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600 })))
    expect((await cancelled).phase).toBe('cancelled')
    expect(store.public()).toMatchObject({ connected: false, tokenStored: false })
  })

  it('rejects a duplicate sign-in while the first device flow is pending', async () => {
    const store = await configuredStore()
    const request: MicrosoftCalendarRequest = async () => response(JSON.stringify({
      device_code: 'secret-code', user_code: 'WXYZ-1234', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 1
    }))
    const service = new MicrosoftCalendarService(store, {
      request,
      openExternal: async () => undefined,
      wait: (_milliseconds, signal) => new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      })
    })
    await service.beginConnect()
    await expect(service.beginConnect()).rejects.toThrow(/already in progress/i)
    expect((await service.cancelConnect()).phase).toBe('cancelled')
  })
})

describe('Outlook Calendar read-only Graph boundary', () => {
  it('normalizes an offset range, bounds selected fields, sanitizes titles, and pages within the same range', async () => {
    const store = await connectedStore()
    const requests: Array<{ url: URL; method?: string; maxResponseBytes?: number }> = []
    const startDateTime = '2026-11-05T00:00:00+03:00'
    const endDateTime = '2026-11-06T00:00:00+03:00'
    const startUtc = '2026-11-04T21:00:00.000Z'
    const endUtc = '2026-11-05T21:00:00.000Z'
    const next = new URL('https://graph.microsoft.com/v1.0/me/calendarView')
    next.searchParams.set('startDateTime', startUtc)
    next.searchParams.set('endDateTime', endUtc)
    next.searchParams.set('$top', '50')
    next.searchParams.set('$select', 'id,subject,start,end,location,isAllDay,showAs')
    next.searchParams.set('$skiptoken', 'next-page')
    const request: MicrosoftCalendarRequest = async (url, _signal, options) => {
      requests.push({ url, method: options.method, maxResponseBytes: options.maxResponseBytes })
      if (url.hostname === 'login.microsoftonline.com') return tokenResponse()
      if (url.searchParams.has('$skiptoken')) return response(JSON.stringify({ value: [] }))
      return response(JSON.stringify({ value: [
        {
          id: 'event-1', subject: 'Review\nnotes', start: { dateTime: '2026-11-05T09:30:00.0000000Z' },
          end: { dateTime: '2026-11-05T10:30:00.0000000Z' }, location: { displayName: 'Room\u0007 2' }, isAllDay: false, showAs: 'busy',
          body: { content: 'This field was not selected and is ignored.' }, attendees: [{ emailAddress: { address: 'private@example.com' } }]
        }
      ], '@odata.nextLink': next.toString() }))
    }
    const service = new MicrosoftCalendarService(store, { request, openExternal: async () => undefined })
    const signal = new AbortController().signal
    const first = await service.listEvents(signal, startDateTime, endDateTime)
    const second = await service.listEvents(signal, undefined, undefined, first.nextPageToken)

    expect(first.events).toEqual([{
      id: 'event-1', title: 'Review notes', start: '2026-11-05T09:30:00.000Z', end: '2026-11-05T10:30:00.000Z',
      isAllDay: false, location: 'Room 2', showAs: 'busy'
    }])
    expect(first.events[0]).not.toHaveProperty('body')
    expect(first.events[0]).not.toHaveProperty('attendees')
    expect(first.note).toMatch(/untrusted external data/i)
    expect(second.events).toEqual([])
    expect(requests).toHaveLength(3)
    expect(requests[1]?.url.origin).toBe('https://graph.microsoft.com')
    expect(requests[1]?.url.pathname).toBe('/v1.0/me/calendarView')
    expect(requests[1]?.url.searchParams.get('startDateTime')).toBe(startUtc)
    expect(requests[1]?.url.searchParams.get('endDateTime')).toBe(endUtc)
    expect(requests[1]?.url.searchParams.get('$top')).toBe('50')
    expect(requests[1]?.url.searchParams.get('$select')).toBe('id,subject,start,end,location,isAllDay,showAs')
    expect(requests[1]?.method).toBe('GET')
    expect(requests[1]?.maxResponseBytes).toBe(1_000_000)
  })

  it('refreshes after a 401 and persists token rotation', async () => {
    const store = await connectedStore()
    let refreshCalls = 0
    let graphCalls = 0
    const request: MicrosoftCalendarRequest = async (url) => {
      if (url.hostname === 'login.microsoftonline.com') {
        refreshCalls += 1
        return response(JSON.stringify({ access_token: `access-${refreshCalls}`, refresh_token: `rotated-${refreshCalls}`, expires_in: 3600 }))
      }
      graphCalls += 1
      return graphCalls === 1 ? response('{}', 401) : response(JSON.stringify({ value: [] }))
    }
    const service = new MicrosoftCalendarService(store, { request, openExternal: async () => undefined })
    await service.listEvents(new AbortController().signal)
    expect(refreshCalls).toBe(2)
    expect(graphCalls).toBe(2)
    expect(store.getRefreshToken()).toBe('rotated-2')
  })

  it('rejects off-host, write, altered-query, duplicate-query, and out-of-range requests before network access', async () => {
    const store = await connectedStore()
    const service = new MicrosoftCalendarService(store, { request: async () => tokenResponse(), openExternal: async () => undefined })
    const signal = new AbortController().signal
    await expect(service.listEvents(signal, '2026-11-05T00:00:00Z', '2026-12-10T00:00:00Z')).rejects.toThrow(/31 days/i)
    await expect(service.listEvents(signal, '2026-11-05T00:00:00Z')).rejects.toThrow(/both the start and end/i)
    await expect(service.listEvents(signal, 'not-a-date', '2026-11-06T00:00:00Z')).rejects.toThrow(/ISO 8601/i)
    await expect(service.listEvents(signal, '2026-02-29T00:00:00Z', '2026-03-01T00:00:00Z')).rejects.toThrow(/valid ISO 8601/i)
    await expect(service.listEvents(signal, undefined, undefined, 'https://evil.example/v1.0/me/calendarView')).rejects.toThrow(/outside the approved/i)
    expect(isAllowedMicrosoftCalendarApiRequest(new URL('https://evil.example/v1.0/me/calendarView'), 'GET')).toBe(false)
    expect(isAllowedMicrosoftCalendarApiRequest(new URL('https://graph.microsoft.com/v1.0/me/calendarView'), 'GET')).toBe(false)
    expect(isAllowedMicrosoftCalendarApiRequest(new URL('https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-11-05T00%3A00%3A00.000Z&endDateTime=2026-11-06T00%3A00%3A00.000Z&$top=50&$select=id%2Csubject%2Cstart%2Cend%2Clocation%2CisAllDay%2CshowAs'), 'POST')).toBe(false)
    const validNext = new URL('https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-11-05T00%3A00%3A00.000Z&endDateTime=2026-11-06T00%3A00%3A00.000Z&$top=50&$select=id%2Csubject%2Cstart%2Cend%2Clocation%2CisAllDay%2CshowAs&$skiptoken=next')
    expect(isAllowedMicrosoftCalendarApiRequest(validNext, 'GET')).toBe(true)
    const unsafe = new URL('https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-11-05T00%3A00%3A00.000Z&endDateTime=2026-11-06T00%3A00%3A00.000Z&$top=50&$select=id%2Csubject%2Cstart%2Cend%2Clocation%2CisAllDay%2CshowAs&$filter=id')
    expect(isAllowedMicrosoftCalendarApiRequest(unsafe, 'GET')).toBe(false)
    const changedRange = new URL(validNext)
    changedRange.searchParams.set('endDateTime', '2026-11-07T00:00:00.000Z')
    await expect(service.listEvents(signal, '2026-11-05T00:00:00Z', '2026-11-06T00:00:00Z', changedRange.toString())).rejects.toThrow(/different Outlook Calendar time range/i)
  })

  it('does not restore a rotated token if disconnect races an in-flight refresh', async () => {
    const store = await connectedStore()
    let finishRefresh!: (value: ReturnType<typeof response>) => void
    const refreshResponse = new Promise<ReturnType<typeof response>>((resolve) => { finishRefresh = resolve })
    const request: MicrosoftCalendarRequest = async (url) => url.hostname === 'login.microsoftonline.com'
      ? refreshResponse
      : response(JSON.stringify({ value: [] }))
    const service = new MicrosoftCalendarService(store, { request, openExternal: async () => undefined })
    const read = service.listEvents(new AbortController().signal)
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf('function'))
    await service.disconnect()
    finishRefresh(response(JSON.stringify({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600 })))
    await expect(read).rejects.toThrow(/connection changed/i)
    expect(store.public()).toMatchObject({ connected: false, tokenStored: false })
  })

  it('registers a single per-call-approved external read tool', async () => {
    const store = await connectedStore()
    const tools = createMicrosoftCalendarTools(new MicrosoftCalendarService(store, { openExternal: async () => undefined }))
    expect(tools.map((tool) => tool.name)).toEqual(['microsoft_calendar_list_events'])
    expect(tools[0]).toMatchObject({ risk: 'external', sessionApprovalAllowed: false })
    expect(defaultPolicy.tools.microsoft_calendar_list_events).toBe('ask')
    expect(tools[0]?.scope?.({}, { grants: {} as never, primaryGrantId: '' })).toMatchObject({ kind: 'url', host: 'graph.microsoft.com' })
  })
})
