import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MICROSOFT_MAIL_SCOPES,
  MicrosoftMailService,
  MicrosoftMailSettingsStore,
  isAllowedMicrosoftMailApiRequest,
  type MicrosoftMailRequest
} from '../src/core/microsoft-mail'
import type { SecretCodec } from '../src/core/settings'
import { defaultPolicy } from '../src/core/gateway/policy'
import { createMicrosoftMailTools } from '../src/tools/microsoft-mail'

let dir = ''
let file = ''
const clientId = '11111111-1111-4111-8111-111111111111'
const codec: SecretCodec = {
  available: true,
  encrypt: async (value) => Buffer.from('enc:' + value).toString('base64'),
  decrypt: async (value) => ({ value: Buffer.from(value, 'base64').toString('utf8').replace(/^enc:/, '') })
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-microsoft-mail-'))
  file = path.join(dir, 'microsoft-mail.json')
})

afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function response(text: string, status = 200) {
  return { status, contentType: 'application/json', text }
}

const tokenResponse = (accessToken = 'graph-access') => response(JSON.stringify({ access_token: accessToken, expires_in: 3600 }))

async function configuredStore(): Promise<MicrosoftMailSettingsStore> {
  const store = new MicrosoftMailSettingsStore(file, codec)
  await store.init()
  await store.updateClientId(clientId)
  return store
}

async function connectedStore(): Promise<MicrosoftMailSettingsStore> {
  const store = await configuredStore()
  await store.saveRefreshToken('microsoft-mail-refresh-secret')
  return store
}

function searchPageUrl(query: string, skip?: string): URL {
  const url = new URL('https://graph.microsoft.com/v1.0/me/messages')
  url.searchParams.set('$search', '"' + query + '"')
  url.searchParams.set('$top', '20')
  url.searchParams.set('$select', 'id,subject,from,receivedDateTime,isRead,hasAttachments')
  if (skip) url.searchParams.set('$skip', skip)
  return url
}

describe('Outlook Mail settings and device-code sign-in', () => {
  it('encrypts refresh tokens and preserves locked ciphertext for later recovery', async () => {
    await connectedStore()
    const raw = await readFile(file, 'utf8')
    expect(raw).toContain('refreshTokenEnc')
    expect(raw).not.toContain('microsoft-mail-refresh-secret')

    const locked = new MicrosoftMailSettingsStore(file)
    await locked.init()
    expect(locked.public()).toMatchObject({ connected: false, tokenStored: true, clientId })
    await locked.clearConnection()
    expect(locked.public()).toMatchObject({ connected: false, tokenStored: false })
  })

  it('validates Application IDs and protects a saved refresh token from client ID changes', async () => {
    const store = await configuredStore()
    await expect(store.updateClientId('not-a-guid')).rejects.toThrow(/Application \(client\) ID/i)
    await store.saveRefreshToken('microsoft-mail-refresh-secret')
    await expect(store.updateClientId('22222222-2222-4222-8222-222222222222')).rejects.toThrow(/clear the saved/i)
  })

  it('requests the read-only Mail.Read delegated scope and never exposes a device code', async () => {
    const store = await configuredStore()
    const seen: Array<{ url: URL; body: URLSearchParams }> = []
    const request: MicrosoftMailRequest = async (url, _signal, options) => {
      seen.push({ url, body: new URLSearchParams(options.body) })
      if (url.pathname.endsWith('/devicecode')) return response(JSON.stringify({
        device_code: 'secret-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 1
      }))
      return response(JSON.stringify({ access_token: 'graph-access', refresh_token: 'microsoft-mail-refresh-secret', expires_in: 3600 }))
    }
    const openExternal = vi.fn(async () => undefined)
    const service = new MicrosoftMailService(store, { request, openExternal, wait: async () => undefined })
    const prompt = await service.beginConnect()
    await vi.waitFor(() => expect(service.connectStatus().phase).toBe('connected'))

    expect(seen[0]?.url.toString()).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/devicecode')
    expect(seen[0]?.body.get('client_id')).toBe(clientId)
    expect(seen[0]?.body.get('scope')).toBe(MICROSOFT_MAIL_SCOPES)
    expect(MICROSOFT_MAIL_SCOPES).toBe('Mail.Read offline_access')
    expect(prompt).toMatchObject({ userCode: 'ABCD-EFGH', verificationUri: 'https://microsoft.com/devicelogin' })
    expect(JSON.stringify(prompt)).not.toContain('secret-device-code')
    expect(openExternal).toHaveBeenCalledWith('https://microsoft.com/devicelogin')
    expect(store.public()).toMatchObject({ connected: true, tokenStored: true })
  })

  it('cancels sign-in without persisting a late token response', async () => {
    const store = await configuredStore()
    let finishToken!: (value: ReturnType<typeof response>) => void
    const token = new Promise<ReturnType<typeof response>>((resolve) => { finishToken = resolve })
    const request: MicrosoftMailRequest = async (url) => url.pathname.endsWith('/devicecode')
      ? response(JSON.stringify({ device_code: 'secret-code', user_code: 'WXYZ-1234', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 1 }))
      : token
    const service = new MicrosoftMailService(store, { request, openExternal: async () => undefined, wait: async () => undefined })
    await service.beginConnect()
    await vi.waitFor(() => expect(finishToken).toBeTypeOf('function'))
    const cancelled = service.cancelConnect()
    finishToken(response(JSON.stringify({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600 })))
    expect((await cancelled).phase).toBe('cancelled')
    expect(store.public()).toMatchObject({ connected: false, tokenStored: false })
  })
})

describe('Outlook Mail read-only Graph boundary', () => {
  it('searches bounded headers, validates page links, and keeps message body out of search results', async () => {
    const store = await connectedStore()
    const next = searchPageUrl('invoice', '20')
    const requests: Array<{ url: URL; method?: string; maxResponseBytes?: number }> = []
    const request: MicrosoftMailRequest = async (url, _signal, options) => {
      requests.push({ url, method: options.method, maxResponseBytes: options.maxResponseBytes })
      if (url.hostname === 'login.microsoftonline.com') return tokenResponse()
      if (url.searchParams.has('$skip')) return response(JSON.stringify({ value: [] }))
      return response(JSON.stringify({
        value: [{
          id: 'AAMk123=', subject: 'Invoice follow up\n\u0007', receivedDateTime: '2026-11-05T09:30:00Z', isRead: false,
          hasAttachments: true, from: { emailAddress: { name: 'Vendor', address: 'vendor@example.com' } },
          body: { contentType: 'text', content: 'not requested' }, toRecipients: [{ emailAddress: { address: 'private@example.com' } }]
        }],
        '@odata.nextLink': next.toString()
      }))
    }
    const service = new MicrosoftMailService(store, { request, openExternal: async () => undefined })
    const first = await service.searchMessages(new AbortController().signal, 'invoice')
    const second = await service.searchMessages(new AbortController().signal, 'invoice', first.nextPageToken)

    expect(first.messages).toEqual([{
      id: 'AAMk123=', subject: 'Invoice follow up', receivedAt: '2026-11-05T09:30:00.000Z', isRead: false,
      hasAttachments: true, from: 'Vendor <vendor@example.com>'
    }])
    expect(first.messages[0]).not.toHaveProperty('body')
    expect(first.messages[0]).not.toHaveProperty('toRecipients')
    expect(first.note).toMatch(/untrusted external data/i)
    expect(second.messages).toEqual([])
    expect(requests).toHaveLength(3)
    expect(requests[1]?.url.origin).toBe('https://graph.microsoft.com')
    expect(requests[1]?.url.pathname).toBe('/v1.0/me/messages')
    expect(requests[1]?.url.searchParams.get('$search')).toBe('"invoice"')
    expect(requests[1]?.url.searchParams.get('$top')).toBe('20')
    expect(requests[1]?.url.searchParams.get('$select')).toBe('id,subject,from,receivedDateTime,isRead,hasAttachments')
    expect(requests[1]?.method).toBe('GET')
    expect(requests[1]?.maxResponseBytes).toBe(1_000_000)
  })

  it('reads one encoded message ID, requests text, and returns a bounded untrusted body', async () => {
    const store = await connectedStore()
    const requests: Array<{ url: URL; headers?: Record<string, string> }> = []
    const request: MicrosoftMailRequest = async (url, _signal, options) => {
      if (url.hostname === 'login.microsoftonline.com') return tokenResponse()
      requests.push({ url, headers: options.headers })
      return response(JSON.stringify({
        id: 'AAMk+abc/=', subject: 'Status', from: { emailAddress: { name: 'Sender', address: 'sender@example.com' } },
        receivedDateTime: '2026-11-05T09:30:00Z', isRead: true, body: { contentType: 'text', content: 'Please review this message.' }
      }))
    }
    const service = new MicrosoftMailService(store, { request, openExternal: async () => undefined })
    const message = await service.readMessage(new AbortController().signal, 'AAMk+abc/=')
    expect(message).toMatchObject({
      id: 'AAMk+abc/=', subject: 'Status', from: 'Sender <sender@example.com>', body: 'Please review this message.',
      note: expect.stringMatching(/untrusted external content/i)
    })
    expect(requests[0]?.url.pathname).toContain('%2Babc%2F%3D')
    expect(requests[0]?.url.searchParams.get('$select')).toBe('id,subject,from,receivedDateTime,isRead,body')
    expect(requests[0]?.headers?.Prefer).toBe('outlook.body-content-type="text"')
    expect(isAllowedMicrosoftMailApiRequest(requests[0]!.url, 'GET')).toBe(true)
  })

  it('converts HTML bodies to text and caps returned body length', async () => {
    const store = await connectedStore()
    const service = new MicrosoftMailService(store, {
      request: async (url) => url.hostname === 'login.microsoftonline.com'
        ? tokenResponse()
        : response(JSON.stringify({ id: 'message-1', body: { contentType: 'html', content: '<p>Hello&nbsp;there</p><script>alert(1)</script><p>' + 'x'.repeat(13_000) + '</p>' } })),
      openExternal: async () => undefined
    })
    const message = await service.readMessage(new AbortController().signal, 'message-1')
    expect(message.body).toContain('Hello there')
    expect(message.body).not.toContain('alert(1)')
    expect(message.body).toHaveLength(12_000)
    expect(message.bodyTruncated).toBe(true)
  })

  it('rejects unsafe query, off-host, altered page, write, and message paths before network access', async () => {
    const store = await connectedStore()
    const service = new MicrosoftMailService(store, { request: async () => tokenResponse(), openExternal: async () => undefined })
    const signal = new AbortController().signal
    await expect(service.searchMessages(signal, ' \n ')).rejects.toThrow(/search phrase/i)
    await expect(service.searchMessages(signal, 'valid', 'https://evil.example/v1.0/me/messages')).rejects.toThrow(/outside the approved/i)
    const changed = searchPageUrl('other').toString()
    await expect(service.searchMessages(signal, 'invoice', changed)).rejects.toThrow(/different Outlook Mail search/i)
    await expect(service.readMessage(signal, '../sendMail')).rejects.toThrow(/valid Outlook message identifier/i)
    expect(isAllowedMicrosoftMailApiRequest(new URL('https://evil.example/v1.0/me/messages'), 'GET')).toBe(false)
    expect(isAllowedMicrosoftMailApiRequest(searchPageUrl('invoice'), 'POST')).toBe(false)
    const valid = searchPageUrl('invoice', '20')
    expect(isAllowedMicrosoftMailApiRequest(valid, 'GET')).toBe(true)
    const injected = new URL(valid)
    injected.searchParams.set('$filter', 'isRead eq false')
    expect(isAllowedMicrosoftMailApiRequest(injected, 'GET')).toBe(false)
    const detail = new URL('https://graph.microsoft.com/v1.0/me/messages/message-1?$select=id,subject,from,receivedDateTime,isRead,body')
    expect(isAllowedMicrosoftMailApiRequest(detail, 'GET')).toBe(true)
    expect(isAllowedMicrosoftMailApiRequest(new URL('https://graph.microsoft.com/v1.0/me/messages/%FF?$select=id,subject,from,receivedDateTime,isRead,body'), 'GET')).toBe(false)
    expect(isAllowedMicrosoftMailApiRequest(new URL('https://graph.microsoft.com/v1.0/me/messages/message-1/sendMail?$select=id,subject,from,receivedDateTime,isRead,body'), 'GET')).toBe(false)
  })

  it('refreshes after a 401 and preserves the disconnect-during-refresh race guard', async () => {
    const store = await connectedStore()
    let refreshCalls = 0
    let graphCalls = 0
    const request: MicrosoftMailRequest = async (url) => {
      if (url.hostname === 'login.microsoftonline.com') {
        refreshCalls += 1
        return response(JSON.stringify({ access_token: 'access-' + refreshCalls, refresh_token: 'rotated-' + refreshCalls, expires_in: 3600 }))
      }
      graphCalls += 1
      return graphCalls === 1
        ? response('{}', 401)
        : response(JSON.stringify({ value: [] }))
    }
    const service = new MicrosoftMailService(store, { request, openExternal: async () => undefined })
    await service.searchMessages(new AbortController().signal, 'quarterly report')
    expect(refreshCalls).toBe(2)
    expect(graphCalls).toBe(2)
    expect(store.getRefreshToken()).toBe('rotated-2')

    const racedStore = await connectedStore()
    let finishRefresh!: (value: ReturnType<typeof response>) => void
    const refreshResponse = new Promise<ReturnType<typeof response>>((resolve) => { finishRefresh = resolve })
    const racedService = new MicrosoftMailService(racedStore, {
      request: async (url) => url.hostname === 'login.microsoftonline.com' ? refreshResponse : response(JSON.stringify({ value: [] })),
      openExternal: async () => undefined
    })
    const read = racedService.searchMessages(new AbortController().signal, 'quarterly report')
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf('function'))
    await racedService.disconnect()
    finishRefresh(response(JSON.stringify({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600 })))
    await expect(read).rejects.toThrow(/connection changed/i)
    expect(racedStore.public()).toMatchObject({ connected: false, tokenStored: false })
  })

  it('registers only read-only per-call-approved tools', async () => {
    const store = await connectedStore()
    const tools = createMicrosoftMailTools(new MicrosoftMailService(store, { openExternal: async () => undefined }))
    expect(tools.map((tool) => tool.name)).toEqual(['microsoft_mail_search_messages', 'microsoft_mail_read_message'])
    expect(tools.every((tool) => tool.risk === 'external' && tool.sessionApprovalAllowed === false)).toBe(true)
    expect(defaultPolicy.tools.microsoft_mail_search_messages).toBe('ask')
    expect(defaultPolicy.tools.microsoft_mail_read_message).toBe('ask')
    expect(tools[0]?.scope?.({ query: 'invoice' }, { grants: {} as never, primaryGrantId: '' })).toMatchObject({ kind: 'url', host: 'graph.microsoft.com' })
  })
})
