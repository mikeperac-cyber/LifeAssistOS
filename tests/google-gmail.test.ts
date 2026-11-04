import { get as httpGet } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultPolicy } from '../src/core/gateway/policy'
import {
  GOOGLE_GMAIL_SCOPES,
  GoogleGmailService,
  GoogleGmailSettingsStore,
  isAllowedGmailApiRequest,
  type GmailRequest
} from '../src/core/google-gmail'
import type { GoogleOAuthClient } from '../src/core/google-oauth'
import type { GrantLookup, ToolContext } from '../src/shared/types'
import type { SecretCodec } from '../src/core/settings'
import { createGoogleGmailTools } from '../src/tools/google-gmail'

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
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-google-gmail-'))
  file = path.join(dir, 'google-gmail.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('Google Gmail settings and OAuth', () => {
  it('encrypts refresh tokens and does not call an undecryptable saved token connected', async () => {
    const store = new GoogleGmailSettingsStore(file, codec)
    await store.init()
    await store.updateClientId(clientId)
    await store.saveRefreshToken('gmail-refresh-secret')
    const raw = await readFile(file, 'utf8')
    expect(raw).toContain('refreshTokenEnc')
    expect(raw).not.toContain('gmail-refresh-secret')

    const lockedStore = new GoogleGmailSettingsStore(file)
    await lockedStore.init()
    expect(lockedStore.public()).toMatchObject({ connected: false, tokenStored: true })
    const lockedService = new GoogleGmailService(lockedStore, { openExternal: async () => undefined })
    expect(lockedService.isReady()).toBe(false)
    const cleared = await lockedService.disconnect()
    expect(cleared).toMatchObject({ revoked: false, revocationAttempted: false })
    expect(cleared.settings).toMatchObject({ connected: false, tokenStored: false })
  })

  it('clears a previously loaded connection when reinitializing from a missing settings file', async () => {
    const store = new GoogleGmailSettingsStore(file, codec)
    await store.init()
    await store.updateClientId(clientId)
    await store.saveRefreshToken('gmail-before-restore')
    await rm(file)

    await store.init()

    expect(store.public()).toMatchObject({ clientId: '', connected: false, tokenStored: false })
    expect(store.getRefreshToken()).toBeUndefined()
  })

  it('uses the shared system-browser PKCE flow and requires every Gmail permission', async () => {
    const store = new GoogleGmailSettingsStore(file, codec)
    await store.init()
    await store.updateClientId(clientId)
    let authUrl = ''
    let tokenOptions: { code: string; codeVerifier: string; redirect_uri: string } | undefined
    const oauthClient: GoogleOAuthClient = {
      generateCodeVerifierAsync: async () => ({ codeVerifier: 'gmail-verifier', codeChallenge: 'gmail-challenge' }),
      generateAuthUrl: (options) => {
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        for (const [key, value] of Object.entries(options)) url.searchParams.set(key, value)
        return url.toString()
      },
      getToken: async (options) => {
        tokenOptions = options
        return { tokens: {
          access_token: 'gmail-access',
          refresh_token: 'gmail-refresh',
          expiry_date: Date.now() + 3_600_000,
          scope: GOOGLE_GMAIL_SCOPES.join(' ')
        } }
      }
    }
    const service = new GoogleGmailService(store, {
      oauthClient: () => oauthClient,
      openExternal: async (url) => {
        authUrl = url
        const parsed = new URL(url)
        const redirectUri = parsed.searchParams.get('redirect_uri')!
        const state = parsed.searchParams.get('state')!
        setTimeout(() => {
          void getText(`${redirectUri}/?code=mail-approved&state=${encodeURIComponent(state)}`).catch(() => undefined)
        }, 10)
      }
    })

    const result = await service.connect()
    const auth = new URL(authUrl)
    expect(auth.searchParams.get('scope')).toBe(GOOGLE_GMAIL_SCOPES.join(' '))
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
    expect(auth.searchParams.get('code_challenge')).toBe('gmail-challenge')
    expect(tokenOptions).toMatchObject({ code: 'mail-approved', codeVerifier: 'gmail-verifier' })
    expect(result).toMatchObject({ connected: true, tokenStored: true })
  })

  it('limits network requests to supported Gmail REST routes and the exact API host', () => {
    expect(isAllowedGmailApiRequest(new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in%3Ainbox'), 'GET')).toBe(true)
    expect(isAllowedGmailApiRequest(new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages/abc_123'), 'GET')).toBe(true)
    expect(isAllowedGmailApiRequest(new URL('https://gmail.googleapis.com/gmail/v1/users/me/drafts'), 'POST')).toBe(true)
    expect(isAllowedGmailApiRequest(new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages/send'), 'POST')).toBe(true)
    expect(isAllowedGmailApiRequest(new URL('https://attacker.example/gmail/v1/users/me/messages'), 'GET')).toBe(false)
    expect(isAllowedGmailApiRequest(new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages/abc_123/trash'), 'POST')).toBe(false)
    expect(isAllowedGmailApiRequest(new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages/abc_123'), 'DELETE')).toBe(false)
  })
})

describe('Google Gmail tools', () => {
  it('requires approval for search, reading, draft, and typed-confirmation sending', async () => {
    const store = new GoogleGmailSettingsStore(file, codec)
    await store.init()
    await store.updateClientId(clientId)
    await store.saveRefreshToken('gmail-refresh')
    const service = new GoogleGmailService(store, { openExternal: async () => undefined })
    const tools = createGoogleGmailTools(service)
    expect(tools.map((tool) => tool.name)).toEqual([
      'gmail_search_messages', 'gmail_read_message', 'gmail_create_draft', 'gmail_send_message'
    ])
    expect(tools.every((tool) => tool.sessionApprovalAllowed === false)).toBe(true)
    expect(tools.every((tool) => tool.risk === 'external')).toBe(true)
    expect(tools.map((tool) => defaultPolicy.tools[tool.name])).toEqual(['ask', 'ask', 'ask', 'ask'])
    expect(tools[3].verb).toBe('send')
    expect(tools[0].scope?.({}, scopeContext)).toMatchObject({ kind: 'url', host: 'gmail.googleapis.com' })
  })

  it('searches headers, reads plain text, creates drafts, and sends only the explicit MIME content', async () => {
    const store = new GoogleGmailSettingsStore(file, codec)
    await store.init()
    await store.updateClientId(clientId)
    await store.saveRefreshToken('gmail-refresh')
    const seen: Array<{ url: string; method?: string; body?: string }> = []
    const request: GmailRequest = async (url, _signal, options) => {
      seen.push({ url: url.toString(), method: options.method, body: options.body })
      if (url.hostname === 'oauth2.googleapis.com') {
        return { status: 200, contentType: 'application/json', text: JSON.stringify({ access_token: 'gmail-access', expires_in: 3600 }) }
      }
      if (options.method === 'GET' && url.pathname.endsWith('/messages')) {
        return { status: 200, contentType: 'application/json', text: JSON.stringify({ messages: [{ id: 'message_123' }] }) }
      }
      if (options.method === 'GET' && url.searchParams.get('format') === 'metadata') {
        return { status: 200, contentType: 'application/json', text: JSON.stringify({
          id: 'message_123', threadId: 'thread_123', snippet: 'Please review the new timetable.',
          payload: { headers: [
            { name: 'From', value: 'colleague@example.com' },
            { name: 'To', value: 'mike@example.com' },
            { name: 'Subject', value: 'New timetable' },
            { name: 'Date', value: 'Tue, 03 Nov 2026 09:00:00 +0300' }
          ] }
        }) }
      }
      if (options.method === 'GET') {
        return { status: 200, contentType: 'application/json', text: JSON.stringify({
          id: 'message_123', threadId: 'thread_123', snippet: 'Please review the new timetable.',
          payload: { mimeType: 'multipart/alternative', headers: [
            { name: 'From', value: 'colleague@example.com' },
            { name: 'To', value: 'mike@example.com' },
            { name: 'Subject', value: 'New timetable' },
            { name: 'Date', value: 'Tue, 03 Nov 2026 09:00:00 +0300' }
          ], parts: [
            { mimeType: 'text/html', body: { data: Buffer.from('<b>Unsafe HTML omitted</b>').toString('base64url') } },
            { mimeType: 'text/plain', filename: 'private-note.txt', body: { data: Buffer.from('Attachment contents omitted').toString('base64url') } },
            { mimeType: 'text/plain', body: { data: Buffer.from('Please review the new timetable.\nThanks, Alex.').toString('base64url') } }
          ] }
        }) }
      }
      if (options.method === 'POST' && url.pathname.endsWith('/drafts')) {
        return { status: 200, contentType: 'application/json', text: JSON.stringify({ id: 'draft_123', message: { id: 'draft_message_123' } }) }
      }
      return { status: 200, contentType: 'application/json', text: JSON.stringify({ id: 'sent_123', threadId: 'thread_sent_123' }) }
    }
    const service = new GoogleGmailService(store, { request, openExternal: async () => undefined })
    const [search, read, draft, send] = createGoogleGmailTools(service)

    const query = search.input.parse({ query: 'from:colleague@example.com is:unread', maxResults: 3 })
    const found = await search.run(query, toolContext)
    expect(found.messages).toMatchObject([{ id: 'message_123', from: 'colleague@example.com', subject: 'New timetable' }])
    expect(found.note).toContain('untrusted')
    expect(new URL(seen.find((entry) => entry.url.includes('?q='))!.url).searchParams.get('q')).toBe('from:colleague@example.com is:unread')
    expect(seen.some((entry) => entry.url.includes('format=metadata'))).toBe(true)

    const opened = await read.run(read.input.parse({ messageId: 'message_123' }), toolContext)
    expect(opened.bodyText).toBe('Please review the new timetable.\nThanks, Alex.')
    expect(opened.bodyText).not.toContain('Unsafe HTML')
    expect(opened.bodyText).not.toContain('Attachment contents')
    expect(opened.note).toContain('untrusted')

    const mail = {
      to: ['client@example.com'],
      cc: ['manager@example.com'],
      bcc: ['archive@example.com'],
      subject: 'Weekly progress update',
      body: 'Hello,\n\nHere is the progress update.'
    }
    const draftArgs = draft.input.parse(mail)
    expect(draft.preview?.(draftArgs, toolContext)).toContain('client@example.com')
    expect(draft.preview?.(draftArgs, toolContext)).toContain('Here is the progress update.')
    expect(await draft.run(draftArgs, toolContext)).toMatchObject({ draftId: 'draft_123' })
    const draftRequest = seen.find((entry) => entry.url.endsWith('/drafts'))
    const draftPayload = JSON.parse(draftRequest?.body ?? '{}') as { message: { raw: string } }
    const draftMime = Buffer.from(draftPayload.message.raw, 'base64url').toString('utf8')
    expect(draftMime).toContain('To: client@example.com')
    expect(draftMime).toContain('Bcc: archive@example.com')
    expect(draftMime).toContain('Content-Type: text/plain; charset=UTF-8')
    expect(draftMime).toContain(Buffer.from('Hello,\r\n\r\nHere is the progress update.').toString('base64'))

    const sendArgs = send.input.parse(mail)
    expect(send.preview?.(sendArgs, toolContext)).toContain('SEND Gmail message')
    expect(send.preview?.(sendArgs, toolContext)).toContain('Bcc: archive@example.com')
    expect(await send.run(sendArgs, toolContext)).toMatchObject({ messageId: 'sent_123' })
    expect(seen.some((entry) => entry.method === 'POST' && entry.url.endsWith('/messages/send'))).toBe(true)
  })

  it('blocks malformed addresses and subject header injection', () => {
    const service = new GoogleGmailService(new GoogleGmailSettingsStore(file), { openExternal: async () => undefined })
    const [,, draft, send] = createGoogleGmailTools(service)
    const invalidBase = { to: ['client@example.com'], subject: 'Project update', body: 'Done.' }
    expect(() => draft.input.parse({ ...invalidBase, to: ['Not an email'] })).toThrow()
    expect(() => send.input.parse({ ...invalidBase, subject: 'Project update\r\nBcc: attacker@example.com' })).toThrow()
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
