import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isAllowedMicrosoftOneDriveApiRequest,
  isSafeMicrosoftOneDriveDownloadUrl,
  MICROSOFT_ONEDRIVE_SCOPES,
  MicrosoftOneDriveService,
  MicrosoftOneDriveSettingsStore,
  type MicrosoftOneDriveRequest
} from '../src/core/microsoft-onedrive'
import type { SecretCodec } from '../src/core/settings'
import { defaultPolicy } from '../src/core/gateway/policy'
import { createMicrosoftOneDriveTools } from '../src/tools/microsoft-onedrive'
import { optionalToolDomain } from '../src/core/agent/tool-discovery-catalog'

let dir = ''
let file = ''
const clientId = '11111111-1111-4111-8111-111111111111'
const codec: SecretCodec = {
  available: true,
  encrypt: async (value) => Buffer.from('enc:' + value).toString('base64'),
  decrypt: async (value) => ({ value: Buffer.from(value, 'base64').toString('utf8').replace(/^enc:/, '') })
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-microsoft-onedrive-'))
  file = path.join(dir, 'microsoft-onedrive.json')
})

afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function response(text: string, status = 200, contentType = 'application/json', location?: string, bytes?: Buffer) {
  return { status, contentType, text, ...(location ? { location } : {}), ...(bytes ? { bytes } : {}) }
}

const tokenResponse = () => response(JSON.stringify({ access_token: 'graph-access', expires_in: 3600 }))

async function configuredStore(): Promise<MicrosoftOneDriveSettingsStore> {
  const store = new MicrosoftOneDriveSettingsStore(file, codec)
  await store.init()
  await store.updateClientId(clientId)
  await store.saveRefreshToken('onedrive-refresh-secret')
  return store
}

describe('Microsoft OneDrive settings and read-only Graph boundary', () => {
  it('encrypts its independent refresh token and preserves locked ciphertext until the user clears it', async () => {
    const store = new MicrosoftOneDriveSettingsStore(file, codec)
    await store.init()
    await store.updateClientId(clientId)
    await store.saveRefreshToken('onedrive-refresh-secret')
    const raw = await readFile(file, 'utf8')
    expect(raw).toContain('refreshTokenEnc')
    expect(raw).not.toContain('onedrive-refresh-secret')

    const locked = new MicrosoftOneDriveSettingsStore(file)
    await locked.init()
    expect(locked.public()).toEqual({ clientId, connected: false, tokenStored: true })
    expect(locked.getRefreshToken()).toBeUndefined()
    await locked.clearConnection()
    expect(locked.public()).toEqual({ clientId, connected: false, tokenStored: false })
  })

  it('clears an old connection when reinitializing after a backup restore removes the settings file', async () => {
    const store = await configuredStore()
    await rm(file)
    await store.init()
    expect(store.public()).toEqual({ clientId: '', connected: false, tokenStored: false })
    expect(store.getRefreshToken()).toBeUndefined()
  })

  it('requests only Files.Read and offline access during device-code sign-in', async () => {
    const store = new MicrosoftOneDriveSettingsStore(file)
    await store.init()
    await store.updateClientId(clientId)
    const request = vi.fn<MicrosoftOneDriveRequest>(async (url) => {
      if (url.pathname.endsWith('/devicecode')) {
        return response(JSON.stringify({
          device_code: 'device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://microsoft.com/devicelogin',
          expires_in: 600,
          interval: 1
        }))
      }
      throw new Error('The test cancels before token polling.')
    })
    const service = new MicrosoftOneDriveService(store, {
      request,
      openExternal: async () => undefined,
      wait: async (_milliseconds, signal) => {
        if (signal.aborted) throw new Error('aborted')
        await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      }
    })

    await service.beginConnect()
    expect(request.mock.calls[0]?.[2].body).toContain('scope=Files.Read+offline_access')
    expect(MICROSOFT_ONEDRIVE_SCOPES).toBe('Files.Read offline_access')
    await service.cancelConnect()
    expect(service.connectStatus().phase).toBe('cancelled')
  })

  it('searches only OneDrive files on fixed Microsoft Graph routes and omits folders', async () => {
    const store = await configuredStore()
    const request = vi.fn<MicrosoftOneDriveRequest>(async (url) => {
      if (url.hostname === 'login.microsoftonline.com') return tokenResponse()
      expect(url.origin).toBe('https://graph.microsoft.com')
      expect(url.pathname).toContain('/v1.0/me/drive/root/search(q=')
      expect(url.searchParams.get('$top')).toBe('10')
      expect(url.searchParams.get('$select')).toContain('file')
      return response(JSON.stringify({ value: [
        { id: 'file-123', name: 'Report 2026.pdf', size: 512, file: { mimeType: 'application/pdf' }, lastModifiedDateTime: '2026-11-01T12:00:00Z' },
        { id: 'folder-123', name: 'Reports', folder: { childCount: 4 } },
        { id: '../other', name: 'Invalid identifier', file: { mimeType: 'text/plain' } }
      ] }))
    })
    const service = new MicrosoftOneDriveService(store, { request, openExternal: async () => undefined })
    const result = await service.searchFiles("Report ' 2026", 10, new AbortController().signal)
    expect(result.files).toEqual([expect.objectContaining({ id: 'file-123', name: 'Report 2026.pdf', mimeType: 'application/pdf' })])
    expect(result.note).toContain('untrusted')
    expect(request.mock.calls.some(([url]) => url.hostname === 'graph.microsoft.com' && decodeURIComponent(url.pathname).includes("Report '' 2026"))).toBe(true)
  })

  it('reads a selected file through a validated temporary link without forwarding the Graph token', async () => {
    const store = await configuredStore()
    const downloadUrl = 'https://tenant-my.sharepoint.com/download?token=short-lived'
    const downloadedBytes = Buffer.from('%PDF-1.7 test')
    const request = vi.fn<MicrosoftOneDriveRequest>(async (url, _signal, options) => {
      if (url.hostname === 'login.microsoftonline.com') return tokenResponse()
      if (url.pathname.endsWith('/content')) return response('', 302, '', downloadUrl)
      if (url.hostname === 'graph.microsoft.com') {
        return response(JSON.stringify({
          id: 'file-123', name: 'Guide.pdf', size: downloadedBytes.length,
          file: { mimeType: 'application/pdf' }, lastModifiedDateTime: '2026-11-01T12:00:00Z'
        }))
      }
      expect(url.toString()).toBe(downloadUrl)
      expect(options.headers?.Authorization).toBeUndefined()
      expect(options.responseType).toBe('bytes')
      return response('', 200, 'application/pdf', undefined, downloadedBytes)
    })
    const service = new MicrosoftOneDriveService(store, { request, openExternal: async () => undefined })
    const result = await service.readFileContent('file-123', new AbortController().signal, { name: 'Guide.pdf', mimeType: 'application/pdf' })
    expect(result.file).toMatchObject({ id: 'file-123', name: 'Guide.pdf' })
    expect(result.bytes).toEqual(downloadedBytes)
    expect(result.note).toContain('untrusted')
    expect(request.mock.calls.filter(([url]) => url.hostname === 'graph.microsoft.com').every(([, , options]) => options.headers?.Authorization === 'Bearer graph-access')).toBe(true)
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('reads files using the same whitespace-normalized name returned by search', async () => {
    const store = await configuredStore()
    const downloadUrl = 'https://tenant-my.sharepoint.com/download?token=short-lived'
    const request = vi.fn<MicrosoftOneDriveRequest>(async (url, _signal, options) => {
      if (url.hostname === 'login.microsoftonline.com') return tokenResponse()
      if (url.hostname === 'graph.microsoft.com' && url.pathname.includes('/search(')) {
        return response(JSON.stringify({ value: [
          { id: 'file-123', name: '  Guide   report.pdf  ', size: 10, file: { mimeType: 'application/pdf' } }
        ] }))
      }
      if (url.pathname.endsWith('/content')) return response('', 302, '', downloadUrl)
      if (url.hostname === 'graph.microsoft.com') {
        return response(JSON.stringify({
          id: 'file-123', name: '  Guide   report.pdf  ', size: 10, file: { mimeType: 'application/pdf' }
        }))
      }
      expect(options.headers?.Authorization).toBeUndefined()
      return response('', 200, 'application/pdf', undefined, Buffer.from('%PDF-1.7 test'))
    })
    const service = new MicrosoftOneDriveService(store, { request, openExternal: async () => undefined })
    const signal = new AbortController().signal
    const search = await service.searchFiles('Guide', 10, signal)
    const selected = search.files[0]
    expect(selected?.name).toBe('Guide report.pdf')
    const read = await service.readFileContent('file-123', signal, { name: selected!.name, mimeType: selected!.mimeType })
    expect(read.file.name).toBe('Guide report.pdf')
  })

  it('rejects download-link host tricks and does not request them', async () => {
    const store = await configuredStore()
    const request = vi.fn<MicrosoftOneDriveRequest>(async (url) => {
      if (url.hostname === 'login.microsoftonline.com') return tokenResponse()
      if (url.pathname.endsWith('/content')) return response('', 302, '', 'https://sharepoint.com.attacker.invalid/file?token=abc')
      return response(JSON.stringify({ id: 'file-123', name: 'notes.txt', size: 10, file: { mimeType: 'text/plain' } }))
    })
    const service = new MicrosoftOneDriveService(store, { request, openExternal: async () => undefined })
    await expect(service.readFileContent('file-123', new AbortController().signal)).rejects.toThrow('outside approved Microsoft download hosts')
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('allows only read-only search, item metadata, and item content routes', () => {
    const search = new URL("https://graph.microsoft.com/v1.0/me/drive/root/search(q='handbook')?$top=10&$select=value%28id%2Cname%2Csize%2Cfile%2Cfolder%2ClastModifiedDateTime%2CparentReference%29")
    const item = new URL('https://graph.microsoft.com/v1.0/me/drive/items/file-123?$select=id%2Cname%2Csize%2Cfile%2Cfolder%2ClastModifiedDateTime%2CparentReference')
    const encodedEqualsItem = new URL('https://graph.microsoft.com/v1.0/me/drive/items/file%3D123/content')
    const content = new URL('https://graph.microsoft.com/v1.0/me/drive/items/file-123/content')
    expect(isAllowedMicrosoftOneDriveApiRequest(search, 'GET')).toBe(true)
    expect(isAllowedMicrosoftOneDriveApiRequest(item, 'GET')).toBe(true)
    expect(isAllowedMicrosoftOneDriveApiRequest(content, 'GET')).toBe(true)
    expect(isAllowedMicrosoftOneDriveApiRequest(encodedEqualsItem, 'GET')).toBe(true)
    expect(isAllowedMicrosoftOneDriveApiRequest(content, 'DELETE')).toBe(false)
    expect(isAllowedMicrosoftOneDriveApiRequest(new URL('https://evil.invalid/v1.0/me/drive/items/file-123/content'), 'GET')).toBe(false)
    expect(isSafeMicrosoftOneDriveDownloadUrl(new URL('https://tenant.sharepoint.com/file?sig=abc'))).toBe(true)
    expect(isSafeMicrosoftOneDriveDownloadUrl(new URL('https://files.1drv.com/file?sig=abc'))).toBe(true)
    expect(isSafeMicrosoftOneDriveDownloadUrl(new URL('https://sharepoint.com.attacker.invalid/file'))).toBe(false)
    expect(isSafeMicrosoftOneDriveDownloadUrl(new URL('http://tenant.sharepoint.com/file'))).toBe(false)
  })

  it('registers per-call approved search and file-read tools as untrusted Drive integrations', () => {
    const store = new MicrosoftOneDriveSettingsStore(file)
    const service = new MicrosoftOneDriveService(store, { openExternal: async () => undefined })
    const tools = createMicrosoftOneDriveTools(service)
    expect(tools.map((tool) => tool.name)).toEqual(['microsoft_onedrive_search_files', 'microsoft_onedrive_read_file'])
    for (const tool of tools) {
      expect(tool.risk).toBe('external')
      expect(tool.sessionApprovalAllowed).toBe(false)
      expect(defaultPolicy.tools[tool.name]).toBe('ask')
      expect(tool.description).toContain('OneDrive')
    }
    expect(tools[0]?.preview?.({ query: 'reports', maxResults: 10 }, {} as never)).toContain('In Cloud Files, matches stay in this view')
    expect(tools[1]?.preview?.({ fileId: 'file-123', fileName: 'Report.pdf', mimeType: 'application/pdf', maxChars: 5_000 }, {} as never)).toContain('when requested in Chat')
    expect(tools[1]?.input.parse({ fileId: 'file-123', fileName: ' Report.pdf ', mimeType: 'application/pdf' }))
      .toMatchObject({ fileName: ' Report.pdf ' })
    expect(optionalToolDomain('microsoft_onedrive_search_files')).toBe('drive')
  })
})
