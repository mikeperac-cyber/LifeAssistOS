import { deflateRawSync } from 'node:zlib'
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
import { readOfficeDocumentTool } from '../src/tools/office-document'

let root = ''
let dataDir = ''
let gateway: Gateway
let sequence = 0

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-office-root-')))
  dataDir = await mkdtemp(path.join(tmpdir(), 'mike-assist-office-data-'))
  const grants = new GrantStore(path.join(dataDir, 'grants.json'))
  await grants.init(root)
  const audit = new AuditLog(path.join(dataDir, 'audit'), 'office-document-test')
  await audit.init()
  const registry = new ToolRegistry().register(readOfficeDocumentTool)
  gateway = new Gateway({ registry, policy: defaultPolicy, audit, grants, approve: async () => true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(dataDir, { recursive: true, force: true })
})

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeZip(files: Record<string, string>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0
  const entries = Object.entries(files)

  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const input = Buffer.from(content, 'utf8')
    const compressed = deflateRawSync(input)
    const crc = crc32(input)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(input.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    localParts.push(local, nameBytes, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(input.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(localOffset, 42)
    centralParts.push(central, nameBytes)
    localOffset += local.length + nameBytes.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(localOffset, 16)
  return Buffer.concat([...localParts, centralDirectory, end])
}

function call(args: unknown): ToolCall {
  sequence += 1
  return { id: `office-${sequence}`, name: 'read_office_document', args }
}

const docx = (body: string): Buffer => makeZip({
  '[Content_Types].xml': '<Types/>',
  'word/document.xml': `<w:document xmlns:w="word"><w:body>${body}</w:body></w:document>`
})

const xlsx = (worksheetTwoTarget = 'worksheets/sheet2.xml'): Buffer => makeZip({
  'xl/workbook.xml': '<workbook xmlns:r="relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Tax &amp; cash" sheetId="2" r:id="rId2"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="${worksheetTwoTarget}"/></Relationships>`,
  'xl/sharedStrings.xml': '<sst><si><t>Product</t></si><si><t>Revenue</t></si><si><r><t>Writing</t></r><r><t> pack</t></r></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1250.75</v></c><c r="C2"><f>SUM(B1:B1)</f></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Transfer</t></is></c><c r="B1" t="b"><v>1</v></c></row></sheetData></worksheet>'
})

describe('read_office_document tool', () => {
  it('extracts Word body paragraphs from an approved .docx file', async () => {
    await writeFile(path.join(root, 'plan.docx'), docx(
      '<w:p><w:r><w:t>Goals &amp; focus</w:t></w:r></w:p><w:p><w:r><w:t>Increase weekly learner feedback.</w:t></w:r></w:p>'
    ))

    const result = await gateway.execute(call({ path: 'plan.docx' }))

    expect(result.ok, result.error).toBe(true)
    expect(result.output).toMatchObject({
      root: 'Workspace', path: 'plan.docx', format: 'docx', truncated: false, hasExtractableText: true
    })
    expect((result.output as { text: string }).text).toContain('Goals & focus')
    expect((result.output as { text: string }).text).toContain('Increase weekly learner feedback.')
  })

  it('reads bounded Excel sheet ranges, shared strings, inline strings, formulas and raw numbers', async () => {
    await writeFile(path.join(root, 'forecast.xlsx'), xlsx())

    const result = await gateway.execute(call({ path: 'forecast.xlsx', startSheet: 2, maxSheets: 1 }))

    expect(result.ok, result.error).toBe(true)
    expect(result.output).toMatchObject({
      format: 'xlsx', totalSheets: 2, startSheet: 2, sheetsRead: 1, truncated: false, hasExtractableText: true
    })
    const text = (result.output as { text: string }).text
    expect(text).toContain('Tax & cash')
    expect(text).toContain('A1=Transfer')
    expect(text).toContain('B1=TRUE')
    expect(text).not.toContain('Summary')

    const firstSheet = await gateway.execute(call({ path: 'forecast.xlsx', startSheet: 1, maxSheets: 1, maxChars: 200 }))
    expect(firstSheet.ok).toBe(true)
    expect(firstSheet.output).toMatchObject({ truncated: true, totalSheets: 2, sheetsRead: 1 })
    expect((firstSheet.output as { text: string }).text).toContain('A2=Writing pack')
    expect((firstSheet.output as { text: string }).text).toContain('B2=1250.75')
    expect((firstSheet.output as { text: string }).text).toContain('C2==SUM(B1:B1)')
  })

  it('marks Word text excerpts that hit the output character cap', async () => {
    await writeFile(path.join(root, 'long.docx'), docx(`<w:p><w:r><w:t>${'A'.repeat(500)}</w:t></w:r></w:p>`))

    const result = await gateway.execute(call({ path: 'long.docx', maxChars: 200 }))

    expect(result.ok, result.error).toBe(true)
    expect(result.output).toMatchObject({
      truncated: true, hasExtractableText: true, totalChars: 500, startChar: 0, charsRead: 200, nextChar: 200
    })
    expect((result.output as { text: string }).text).toHaveLength(200)

    const nextPage = await gateway.execute(call({ path: 'long.docx', startChar: 200, maxChars: 200 }))
    expect(nextPage.ok).toBe(true)
    expect(nextPage.output).toMatchObject({ startChar: 200, charsRead: 200, nextChar: 400, truncated: true })

    const finalPage = await gateway.execute(call({ path: 'long.docx', startChar: 400, maxChars: 200 }))
    expect(finalPage.ok).toBe(true)
    expect(finalPage.output).toMatchObject({ startChar: 400, charsRead: 100, truncated: false })
  })

  it('continues a Word excerpt from the exact next character', async () => {
    await writeFile(path.join(root, 'paged.docx'), docx(
      '<w:p><w:r><w:t>first paragraph</w:t></w:r></w:p><w:p><w:r><w:t>second paragraph</w:t></w:r></w:p>'
    ))

    const first = await gateway.execute(call({ path: 'paged.docx', maxChars: 200 }))
    expect(first.ok).toBe(true)
    expect(first.output).toMatchObject({ totalChars: 33, startChar: 0, charsRead: 33, truncated: false })

    const page = await gateway.execute(call({ path: 'paged.docx', startChar: 6, maxChars: 200 }))
    expect(page.ok).toBe(true)
    expect(page.output).toMatchObject({ totalChars: 33, startChar: 6, charsRead: 27, truncated: false })
    expect((page.output as { text: string }).text).toBe('paragraph\n\nsecond paragraph')
  })

  it('pages Excel rows within one sheet and returns an exact continuation cursor', async () => {
    await writeFile(path.join(root, 'paged.xlsx'), xlsx())

    const first = await gateway.execute(call({ path: 'paged.xlsx', startSheet: 1, maxSheets: 1, maxRows: 1 }))
    expect(first.ok).toBe(true)
    expect(first.output).toMatchObject({
      totalSheets: 2,
      sheetsRead: 1,
      nextSheet: 1,
      truncated: true,
      sheetRanges: [{ sheet: 1, name: 'Summary', totalRows: 2, startRow: 1, rowsRead: 1, nextRow: 2 }]
    })
    expect((first.output as { text: string }).text).toContain('Row 1:')
    expect((first.output as { text: string }).text).not.toContain('Row 2:')

    const second = await gateway.execute(call({ path: 'paged.xlsx', startSheet: 1, maxSheets: 1, startRow: 2, maxRows: 1 }))
    expect(second.ok).toBe(true)
    expect(second.output).toMatchObject({
      sheetsRead: 1,
      nextSheet: 2,
      truncated: true,
      sheetRanges: [{ sheet: 1, name: 'Summary', totalRows: 2, startRow: 2, rowsRead: 1 }]
    })
    expect((second.output as { text: string }).text).toContain('Row 2:')
    expect((second.output as { text: string }).text).not.toContain('Row 1:')
  })

  it('keeps Excel rows whole when the character limit is reached', async () => {
    const rows = ['A'.repeat(80), 'B'.repeat(80)]
      .map((value, index) => `<row r="${index + 1}"><c r="A${index + 1}" t="inlineStr"><is><t>${value}</t></is></c></row>`)
      .join('')
    const workbook = makeZip({
      'xl/workbook.xml': '<workbook xmlns:r="relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`
    })
    await writeFile(path.join(root, 'row-limit.xlsx'), workbook)

    const result = await gateway.execute(call({ path: 'row-limit.xlsx', maxChars: 200 }))

    expect(result.ok, result.error).toBe(true)
    expect(result.output).toMatchObject({
      truncated: true,
      nextSheet: 1,
      sheetRanges: [{ sheet: 1, totalRows: 2, startRow: 1, rowsRead: 1, nextRow: 2 }]
    })
    const output = result.output as { text: string }
    expect(output.text.length).toBeLessThanOrEqual(200)
    expect(output.text).toContain('Row 1:')
    expect(output.text).not.toContain('Row 2:')
  })

  it('rejects oversized expanded parts, external worksheet links, and paths outside the grant', async () => {
    await writeFile(path.join(root, 'large.docx'), docx(`<w:p><w:r><w:t>${'x'.repeat(8_000_001)}</w:t></w:r></w:p>`))
    await writeFile(path.join(root, 'unsafe.docx'), docx('<!DOCTYPE document [<!ENTITY secret "value">]>'))
    await writeFile(path.join(root, 'external.xlsx'), xlsx('https://example.invalid/sheet.xml'))

    const large = await gateway.execute(call({ path: 'large.docx' }))
    expect(large.ok).toBe(false)
    expect(large.error).toContain('exceeds the extraction limit')

    const unsafe = await gateway.execute(call({ path: 'unsafe.docx' }))
    expect(unsafe.ok).toBe(false)
    expect(unsafe.error).toContain('unsupported XML declarations')

    const external = await gateway.execute(call({ path: 'external.xlsx', startSheet: 2 }))
    expect(external.ok).toBe(false)
    expect(external.error).toContain('External worksheet references')

    const escaped = await gateway.execute(call({ path: '../outside.docx' }))
    expect(escaped.blocked).toBe(true)
  })

  it('rejects non-ZIP and unsupported Office formats', async () => {
    await writeFile(path.join(root, 'plain.docx'), 'not a ZIP archive')
    await writeFile(path.join(root, 'legacy.xls'), 'legacy spreadsheet')

    const invalidArchive = await gateway.execute(call({ path: 'plain.docx' }))
    expect(invalidArchive.ok).toBe(false)
    expect(invalidArchive.error).toContain('ZIP document')

    const unsupported = await gateway.execute(call({ path: 'legacy.xls' }))
    expect(unsupported.ok).toBe(false)
    expect(unsupported.error).toContain('Only .docx Word documents')
  })
})
