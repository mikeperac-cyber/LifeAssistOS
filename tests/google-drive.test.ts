import { get as httpGet } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GoogleDriveService, GoogleDriveSettingsStore, GOOGLE_DRIVE_SCOPE, isAllowedGoogleDriveApiRequest, type GoogleDriveRequest } from '../src/core/google-drive'
import type { GoogleOAuthClient } from '../src/core/google-oauth'
import { defaultPolicy } from '../src/core/gateway/policy'
import type { SecretCodec } from '../src/core/settings'
import type { ToolContext } from '../src/shared/types'
import { createGoogleDriveTools } from '../src/tools/google-drive'

let dir = ''
let file = ''
const clientId = '123456789012-example.apps.googleusercontent.com'
const codec: SecretCodec = {
  available: true,
  encrypt: async (value) => Buffer.from(`enc:${value}`).toString('base64'),
  decrypt: async (value) => ({ value: Buffer.from(value, 'base64').toString('utf8').replace(/^enc:/, '') })
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-google-drive-'))
  file = path.join(dir, 'google-drive.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function connectedStore(): Promise<GoogleDriveSettingsStore> {
  const store = new GoogleDriveSettingsStore(file, codec)
  await store.init()
  await store.updateClientId(clientId)
  await store.saveRefreshToken('drive-refresh-secret')
  return store
}

function response(text: string, contentType = 'application/json') {
  return { status: 200, contentType, text }
}

const tokenResponse = () => response(JSON.stringify({ access_token: 'drive-access', expires_in: 3600 }))

describe('Google Drive settings and fixed API boundary', () => {
  it('encrypts refresh tokens and preserves locked ciphertext without treating it as connected', async () => {
    const store = new GoogleDriveSettingsStore(file, codec)
    await store.init()
    await store.updateClientId(clientId)
    await store.saveRefreshToken('drive-refresh-secret')
    const raw = await readFile(file, 'utf8')
    expect(raw).toContain('refreshTokenEnc')
    expect(raw).not.toContain('drive-refresh-secret')

    const locked = new GoogleDriveSettingsStore(file)
    await locked.init()
    expect(locked.public()).toMatchObject({ connected: false, tokenStored: true })
    expect(new GoogleDriveService(locked, { openExternal: async () => undefined }).isReady()).toBe(false)
    const cleared = await new GoogleDriveService(locked, { openExternal: async () => undefined }).disconnect()
    expect(cleared.settings).toMatchObject({ connected: false, tokenStored: false })
    expect(cleared.revocationAttempted).toBe(false)
  })

  it('clears a previously loaded connection when reinitializing from a missing settings file', async () => {
    const store = new GoogleDriveSettingsStore(file, codec)
    await store.init()
    await store.updateClientId(clientId)
    await store.saveRefreshToken('drive-before-restore')
    await rm(file)

    await store.init()

    expect(store.public()).toMatchObject({ clientId: '', connected: false, tokenStored: false })
    expect(store.getRefreshToken()).toBeUndefined()
  })

  it('uses browser PKCE and requests only the read-only Drive scope', async () => {
    const store = new GoogleDriveSettingsStore(file, codec)
    await store.init()
    await store.updateClientId(clientId)
    let authUrl = ''
    const oauthClient: GoogleOAuthClient = {
      generateCodeVerifierAsync: async () => ({ codeVerifier: 'drive-verifier', codeChallenge: 'drive-challenge' }),
      generateAuthUrl: (options) => {
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        for (const [key, value] of Object.entries(options)) url.searchParams.set(key, value)
        return url.toString()
      },
      getToken: async () => ({ tokens: {
        access_token: 'drive-access',
        refresh_token: 'drive-refresh-secret',
        expiry_date: Date.now() + 3_600_000,
        scope: GOOGLE_DRIVE_SCOPE
      } })
    }
    const service = new GoogleDriveService(store, {
      oauthClient: () => oauthClient,
      openExternal: async (url) => {
        authUrl = url
        const parsed = new URL(url)
        const redirectUri = parsed.searchParams.get('redirect_uri')!
        const state = parsed.searchParams.get('state')!
        setTimeout(() => { void getText(`${redirectUri}/?code=drive-approved&state=${encodeURIComponent(state)}`).catch(() => undefined) }, 10)
      }
    })

    const result = await service.connect()
    const auth = new URL(authUrl)
    expect(auth.searchParams.get('scope')).toBe(GOOGLE_DRIVE_SCOPE)
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
    expect(auth.searchParams.get('code_challenge')).toBe('drive-challenge')
    expect(result).toMatchObject({ connected: true, tokenStored: true })
  })

  it('permits only GET file-list, metadata, export, and media routes on the exact API host', () => {
    expect(isAllowedGoogleDriveApiRequest(new URL('https://www.googleapis.com/drive/v3/files?q=report'), 'GET')).toBe(true)
    expect(isAllowedGoogleDriveApiRequest(new URL('https://www.googleapis.com/drive/v3/files/file-123'), 'GET')).toBe(true)
    expect(isAllowedGoogleDriveApiRequest(new URL('https://www.googleapis.com/drive/v3/files/file-123/export?mimeType=text%2Fplain'), 'GET')).toBe(true)
    expect(isAllowedGoogleDriveApiRequest(new URL('https://www.googleapis.com/drive/v3/files/file-123?alt=media'), 'GET')).toBe(true)
    expect(isAllowedGoogleDriveApiRequest(new URL('https://attacker.example/drive/v3/files'), 'GET')).toBe(false)
    expect(isAllowedGoogleDriveApiRequest(new URL('https://www.googleapis.com.evil.example/drive/v3/files'), 'GET')).toBe(false)
    expect(isAllowedGoogleDriveApiRequest(new URL('https://www.googleapis.com/drive/v3/files/file-123/permissions'), 'GET')).toBe(false)
    expect(isAllowedGoogleDriveApiRequest(new URL('https://www.googleapis.com/drive/v3/files/file-123'), 'DELETE')).toBe(false)
  })
})

describe('Google Drive reads and tools', () => {
  it('escapes Drive query literals, limits page size, and supports pagination', async () => {
    const store = await connectedStore()
    let searchUrl: URL | undefined
    const request: GoogleDriveRequest = async (url) => {
      if (url.hostname === 'oauth2.googleapis.com') return tokenResponse()
      searchUrl = new URL(url)
      return response(JSON.stringify({
        nextPageToken: 'page-token-2',
        files: [{ id: 'file-123', name: 'Teacher\'s report', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-11-03T09:00:00Z' }]
      }))
    }
    const service = new GoogleDriveService(store, { request, openExternal: async () => undefined })
    const result = await service.searchFiles("teacher's report", 50, new AbortController().signal, 'page-token-1')

    expect(searchUrl?.hostname).toBe('www.googleapis.com')
    expect(searchUrl?.searchParams.get('pageSize')).toBe('20')
    expect(searchUrl?.searchParams.get('pageToken')).toBe('page-token-1')
    expect(searchUrl?.searchParams.get('q')).toContain("name contains 'teacher\\'s report'")
    expect(result.files[0]?.name).toBe("Teacher's report")
    expect(result.nextPageToken).toBe('page-token-2')
    expect(result.note).toContain('untrusted')
    await expect(service.searchFiles('query', Number.NaN, new AbortController().signal)).rejects.toThrow(/1 and 20/)
  })

  it('reads only bounded text from a supported file and checks download permission first', async () => {
    const store = await connectedStore()
    const seen: Array<{ url: URL; authorization?: string }> = []
    const request: GoogleDriveRequest = async (url, _signal, options) => {
      seen.push({ url: new URL(url), authorization: options.headers?.Authorization })
      if (url.hostname === 'oauth2.googleapis.com') return tokenResponse()
      if (url.pathname.endsWith('/file-123') && !url.searchParams.has('alt')) return response(JSON.stringify({
        id: 'file-123', name: 'notes.txt', mimeType: 'text/plain', capabilities: { canDownload: true }
      }))
      return response('0123456789abcdef'.repeat(40), 'text/plain; charset=utf-8')
    }
    const service = new GoogleDriveService(store, { request, openExternal: async () => undefined })
    const result = await service.readFile('file-123', new AbortController().signal, 4, 500)
    expect(result.text.slice(0, 5)).toBe('45678')
    expect(result).toMatchObject({ startChar: 4, charsRead: 500, totalChars: 640, truncated: true, nextStartChar: 504 })
    expect(result.note).toContain('untrusted')
    expect(seen.every((entry) => entry.authorization === undefined || entry.authorization === 'Bearer drive-access')).toBe(true)
    expect(seen.some((entry) => entry.url.pathname.endsWith('/file-123') && entry.url.searchParams.get('supportsAllDrives') === 'true')).toBe(true)
    expect(seen.some((entry) => entry.url.searchParams.get('alt') === 'media')).toBe(true)

    let contentRequested = false
    const denied = new GoogleDriveService(store, {
      openExternal: async () => undefined,
      request: async (url) => {
        if (url.hostname === 'oauth2.googleapis.com') return tokenResponse()
        if (url.pathname.endsWith('/file-123') && !url.searchParams.has('alt')) return response(JSON.stringify({
          id: 'file-123', name: 'private.txt', mimeType: 'text/plain', capabilities: { canDownload: false }
        }))
        contentRequested = true
        return response('must not be read', 'text/plain')
      }
    })
    await expect(denied.readFile('file-123', new AbortController().signal)).rejects.toThrow(/does not allow/)
    expect(contentRequested).toBe(false)
  })

  it('exports Workspace formats as text and refuses unsupported binaries', async () => {
    const store = await connectedStore()
    let exportUrl: URL | undefined
    const request: GoogleDriveRequest = async (url) => {
      if (url.hostname === 'oauth2.googleapis.com') return tokenResponse()
      if (!url.pathname.endsWith('/export')) return response(JSON.stringify({
        id: 'file-123', name: 'brief.doc', mimeType: 'application/vnd.google-apps.document', capabilities: { canDownload: true }
      }))
      exportUrl = new URL(url)
      return response('Business brief', 'text/plain')
    }
    const service = new GoogleDriveService(store, { request, openExternal: async () => undefined })
    const result = await service.readFile('file-123', new AbortController().signal)
    expect(result.text).toBe('Business brief')
    expect(exportUrl?.searchParams.get('mimeType')).toBe('text/plain')

    const binary = new GoogleDriveService(store, {
      openExternal: async () => undefined,
      request: async (url) => {
        if (url.hostname === 'oauth2.googleapis.com') return tokenResponse()
        return response(JSON.stringify({ id: 'file-123', name: 'legacy.doc', mimeType: 'application/msword', capabilities: { canDownload: true } }))
      }
    })
    await expect(binary.readFile('file-123', new AbortController().signal)).rejects.toThrow(/not supported yet/)
  })

  it('downloads a PDF in memory and reuses the bounded PDF text extractor', async () => {
    const store = await connectedStore()
    const pdfBytes = makePdf(['Drive forecast summary'])
    let requestedBytes = false
    const service = new GoogleDriveService(store, {
      openExternal: async () => undefined,
      request: async (url, _signal, options) => {
        if (url.hostname === 'oauth2.googleapis.com') return tokenResponse()
        if (url.searchParams.has('alt')) {
          requestedBytes = options.responseType === 'bytes'
          return { status: 200, contentType: 'application/pdf', text: '', bytes: pdfBytes }
        }
        return response(JSON.stringify({
          id: 'file-123', name: 'forecast.pdf', mimeType: 'application/pdf', capabilities: { canDownload: true }
        }))
      }
    })
    const [, readFileTool] = createGoogleDriveTools(service)
    const args = readFileTool!.input.parse({
      fileId: 'file-123', fileName: 'forecast.pdf', mimeType: 'application/pdf', maxChars: 500
    })
    const context: ToolContext = { kind: 'none', signal: new AbortController().signal }
    const output = await readFileTool!.run(args, context) as { text: string; format: string; bytes: number }
    expect(output).toMatchObject({ format: 'pdf', bytes: pdfBytes.length })
    expect(output.text).toContain('Drive forecast summary')
    expect(requestedBytes).toBe(true)
  })

  it('extracts DOCX and XLSX Drive downloads through the shared Office parser', async () => {
    const store = await connectedStore()
    const workbook = makeOfficeZip({
      'xl/workbook.xml': '<workbook xmlns:r="relationships"><sheets><sheet name="Forecast" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Quarter revenue</t></is></c></row></sheetData></worksheet>'
    })
    const word = makeOfficeZip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document xmlns:w="word"><w:body><w:p><w:r><w:t>Business plan</w:t></w:r></w:p></w:body></w:document>'
    })
    const readFromDrive = async (fileName: string, mimeType: string, bytes: Buffer): Promise<{ text: string; format: string }> => {
      const service = new GoogleDriveService(store, {
        openExternal: async () => undefined,
        request: async (url) => {
          if (url.hostname === 'oauth2.googleapis.com') return tokenResponse()
          if (url.searchParams.has('alt')) return { status: 200, contentType: mimeType, text: '', bytes }
          return response(JSON.stringify({ id: 'file-123', name: fileName, mimeType, capabilities: { canDownload: true } }))
        }
      })
      const [, read] = createGoogleDriveTools(service)
      const args = read!.input.parse({ fileId: 'file-123', fileName, mimeType })
      const context: ToolContext = { kind: 'none', signal: new AbortController().signal }
      return await read!.run(args, context) as { text: string; format: string }
    }

    const docx = await readFromDrive('plan.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', word)
    const xlsx = await readFromDrive('forecast.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', workbook)
    expect(docx).toMatchObject({ format: 'docx' })
    expect(docx.text).toContain('Business plan')
    expect(xlsx).toMatchObject({ format: 'xlsx' })
    expect(xlsx.text).toContain('A1=Quarter revenue')
  })

  it('exposes read-only Drive tools that require approval on every call', async () => {
    const store = await connectedStore()
    const tools = createGoogleDriveTools(new GoogleDriveService(store, { openExternal: async () => undefined }))
    expect(GOOGLE_DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.readonly')
    expect(tools.map((tool) => tool.name)).toEqual(['google_drive_search_files', 'google_drive_read_file'])
    expect(tools.every((tool) => tool.risk === 'external' && tool.sessionApprovalAllowed === false)).toBe(true)
    expect(tools.map((tool) => defaultPolicy.tools[tool.name])).toEqual(['ask', 'ask'])
    expect(tools[0]?.scope?.({ query: 'reports', maxResults: 3 }, { grants: {} as never, primaryGrantId: '' })).toMatchObject({ kind: 'url', host: 'www.googleapis.com' })
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

function makePdf(pageText: string[]): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageText.map((_text, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pageText.length} >>`,
    ...pageText.flatMap((text, index) => {
      const pageObject = 3 + index * 2
      const contentObject = pageObject + 1
      const stream = `BT /F1 1 Tf 72 220 Td (${text}) Tj ET`
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 ${3 + pageText.length * 2} 0 R >> >> /Contents ${contentObject} 0 R >>`,
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
      ]
    }),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  const parts = [Buffer.from('%PDF-1.4\n', 'ascii')]
  const offsets = [0]
  let length = parts[0]!.length
  objects.forEach((object, index) => {
    offsets.push(length)
    const part = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'ascii')
    parts.push(part)
    length += part.length
  })
  const xrefOffset = length
  const xref = [
    `xref\n0 ${offsets.length}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  ].join('')
  parts.push(Buffer.from(xref, 'ascii'))
  return Buffer.concat(parts)
}

function makeOfficeZip(files: Record<string, string>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0
  const entries = Object.entries(files)
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const input = Buffer.from(content, 'utf8')
    const crc = crc32(input)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(input.length, 18)
    local.writeUInt32LE(input.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    localParts.push(local, nameBytes, input)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(input.length, 20)
    central.writeUInt32LE(input.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(localOffset, 42)
    centralParts.push(central, nameBytes)
    localOffset += local.length + nameBytes.length + input.length
  }
  const directory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(localOffset, 16)
  return Buffer.concat([...localParts, directory, end])
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
