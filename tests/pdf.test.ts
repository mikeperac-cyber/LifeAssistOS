import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditLog } from '../src/core/audit/log'
import { Gateway } from '../src/core/gateway/gateway'
import { defaultPolicy } from '../src/core/gateway/policy'
import { GrantStore } from '../src/core/grants'
import { ToolRegistry } from '../src/core/registry'
import type { ToolCall } from '../src/shared/types'
import { readPdfTool } from '../src/tools/pdf'

let root = ''
let dataDir = ''
let grants: GrantStore
let gateway: Gateway
let sequence = 0

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-pdf-root-')))
  dataDir = await mkdtemp(path.join(tmpdir(), 'mike-assist-pdf-data-'))
  grants = new GrantStore(path.join(dataDir, 'grants.json'))
  await grants.init(root)
  const audit = new AuditLog(path.join(dataDir, 'audit'), 'pdf-test')
  await audit.init()
  const registry = new ToolRegistry().register(readPdfTool)
  gateway = new Gateway({ registry, policy: defaultPolicy, audit, grants, approve: async () => true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(dataDir, { recursive: true, force: true })
})

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

function call(args: unknown): ToolCall {
  sequence += 1
  return { id: `pdf-${sequence}`, name: 'read_pdf', args }
}

describe('read_pdf tool', () => {
  it('extracts selectable text from an approved PDF through the gateway', async () => {
    await writeFile(path.join(root, 'report.pdf'), makePdf(['Hello Mike']))

    const result = await gateway.execute(call({ path: 'report.pdf' }))

    expect(result.ok, result.error).toBe(true)
    expect(result.output).toMatchObject({
      root: 'Workspace',
      path: 'report.pdf',
      totalPages: 1,
      pagesRead: 1,
      hasExtractableText: true,
      truncated: false
    })
    expect((result.output as { text: string }).text).toContain('Hello Mike')
  })

  it('respects page and character bounds', async () => {
    await writeFile(path.join(root, 'report.pdf'), makePdf(['First page', 'Second page']))

    const result = await gateway.execute(call({ path: 'report.pdf', startPage: 2, maxPages: 1, maxChars: 200 }))

    expect(result.ok, result.error).toBe(true)
    expect(result.output).toMatchObject({ startPage: 2, pagesRead: 1, truncated: false })
    expect((result.output as { text: string }).text).toContain('Second page')
    expect((result.output as { text: string }).text).not.toContain('First page')
  })

  it('flags text excerpts that reach the character limit and scanned-style PDFs with no text', async () => {
    await writeFile(path.join(root, 'long.pdf'), makePdf(['A'.repeat(500)]))
    await writeFile(path.join(root, 'scan.pdf'), makePdf(['']))

    const longResult = await gateway.execute(call({ path: 'long.pdf', maxChars: 200 }))
    expect(longResult.ok).toBe(true)
    expect(longResult.output).toMatchObject({ truncated: true, hasExtractableText: true })
    expect((longResult.output as { text: string }).text).toHaveLength(200)

    const scanResult = await gateway.execute(call({ path: 'scan.pdf' }))
    expect(scanResult.ok).toBe(true)
    expect(scanResult.output).toMatchObject({
      hasExtractableText: false,
      note: expect.stringContaining('scanned PDF')
    })
  })

  it('continues a page-local character cursor without losing PDF text', async () => {
    const source = 'A'.repeat(250)
    await writeFile(path.join(root, 'long.pdf'), makePdf([source]))

    const first = await gateway.execute(call({ path: 'long.pdf', maxChars: 200 }))
    expect(first.ok, first.error).toBe(true)
    const firstPage = first.output as { text: string; startPage: number; startChar: number; nextPage?: number; nextChar?: number; truncated: boolean }
    expect(firstPage).toMatchObject({ startPage: 1, startChar: 0, nextPage: 1, truncated: true })
    expect(firstPage.nextChar).toBeGreaterThan(0)

    const next = await gateway.execute(call({
      path: 'long.pdf', startPage: firstPage.nextPage, startChar: firstPage.nextChar, maxChars: 200
    }))
    expect(next.ok, next.error).toBe(true)
    const nextPage = next.output as { text: string; startPage: number; startChar: number; truncated: boolean }
    expect(nextPage).toMatchObject({ startPage: 1, startChar: firstPage.nextChar, truncated: false })

    const pageText = (text: string): string => text.replace(/^--- Page 1 ---\n/, '')
    expect(pageText(firstPage.text) + pageText(nextPage.text)).toBe(source)
  })

  it('rejects non-PDF content and paths outside the approved folder', async () => {
    await writeFile(path.join(root, 'not-a-pdf.pdf'), 'plain text')

    const invalidFile = await gateway.execute(call({ path: 'not-a-pdf.pdf' }))
    expect(invalidFile.ok).toBe(false)
    expect(invalidFile.error).toContain('PDF header')

    const escaped = await gateway.execute(call({ path: '../outside.pdf' }))
    expect(escaped.blocked).toBe(true)
  })
})
