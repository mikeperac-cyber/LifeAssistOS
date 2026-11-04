import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { z } from 'zod'
import type { ToolDef } from '../shared/types'
import { pathContext, resolveGrantPath, ToolError } from './paths'

const MAX_ARCHIVE_BYTES = 25_000_000
const MAX_ARCHIVE_ENTRIES = 2_000
const MAX_PART_BYTES = 8_000_000
const MAX_TOTAL_XML_BYTES = 32_000_000
const DEFAULT_MAX_CHARS = 5_000
const DEFAULT_MAX_ROWS = 100

const rootField = z.string().optional().describe('Approved folder to use. Omit for the primary workspace.')
const readOfficeInput = z.object({
  root: rootField,
  path: z.string().trim().min(1).describe('Relative path to a .docx or .xlsx file inside an approved folder.'),
  startChar: z.number().int().min(0).max(16_000_000).optional()
    .describe('0-based character offset for continuing a Word document excerpt.'),
  startRow: z.number().int().min(1).max(1_048_577).optional()
    .describe('1-based position among non-empty Excel rows for continuing a worksheet page.'),
  maxRows: z.number().int().min(1).max(500).optional()
    .describe('Maximum number of non-empty Excel rows to return per worksheet.'),
  startSheet: z.number().int().min(1).max(10_000).optional(),
  maxSheets: z.number().int().min(1).max(10).optional(),
  maxChars: z.number().int().min(200).max(6_000).optional()
})

export type ReadOfficeArgs = z.infer<typeof readOfficeInput>
export type OfficeExtractionOptions = Pick<ReadOfficeArgs, 'startChar' | 'startRow' | 'maxRows' | 'startSheet' | 'maxSheets' | 'maxChars'>

export interface OfficeDocumentOutput {
  root: string
  path: string
  format: 'docx' | 'xlsx'
  bytes: number
  text: string
  truncated: boolean
  hasExtractableText: boolean
  note?: string
  totalSheets?: number
  startSheet?: number
  sheetsRead?: number
  totalChars?: number
  startChar?: number
  charsRead?: number
  nextChar?: number
  sheetRanges?: Array<{
    sheet: number
    name: string
    totalRows: number
    startRow: number
    rowsRead: number
    nextRow?: number
  }>
  nextSheet?: number
}

interface ZipEntry {
  name: string
  flags: number
  method: number
  crc: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

interface ExtractionBudget { remaining: number }

export const readOfficeDocumentTool: ToolDef<ReadOfficeArgs, OfficeDocumentOutput> = {
  name: 'read_office_document',
  description:
    'Extract bounded text from a .docx or .xlsx file inside an approved folder. Supports up to 25 MB per file and 6,000 output characters. Continue Word excerpts with startChar; continue Excel worksheet pages with startSheet and startRow, a 1-based position among non-empty rows. Excel values are raw and number/date formatting is not applied; embedded images and macros are not executed or analyzed.',
  risk: 'read',
  timeoutMs: 45_000,
  input: readOfficeInput,
  async scope(args, context) {
    const grant = context.grants.get(args.root)
    const resolved = await resolveGrantPath(grant, args.path)
    return {
      kind: 'path',
      grantId: grant.id,
      grantLabel: grant.label,
      path: resolved.path,
      relative: resolved.relative
    }
  },
  preview(args) {
    return `Extract bounded text from ${args.path} in the approved folder.`
  },
  async run(args, context) {
    const { path: target, grant, relative } = pathContext(context)
    const extension = path.extname(relative).toLowerCase()
    if (extension !== '.docx' && extension !== '.xlsx') {
      throw new ToolError('Only .docx Word documents and .xlsx Excel workbooks are supported.')
    }
    if (extension === '.docx' && (args.startRow !== undefined || args.startSheet !== undefined || args.maxRows !== undefined || args.maxSheets !== undefined)) {
      throw new ToolError('Excel row and sheet ranges can only be used with .xlsx workbooks.')
    }
    if (extension === '.xlsx' && args.startChar !== undefined) {
      throw new ToolError('The character continuation offset can only be used with .docx documents.')
    }

    const info = await stat(target)
    if (!info.isFile()) throw new ToolError('That path is not a regular file.')
    if (info.size > MAX_ARCHIVE_BYTES) {
      throw new ToolError(`That document is larger than the ${MAX_ARCHIVE_BYTES / 1_000_000} MB limit.`)
    }

    const handle = await open(target, 'r')
    let bytes: Buffer
    try {
      const current = await handle.stat()
      if (!current.isFile()) throw new ToolError('That path is not a regular file.')
      if (current.size > MAX_ARCHIVE_BYTES) {
        throw new ToolError(`That document is larger than the ${MAX_ARCHIVE_BYTES / 1_000_000} MB limit.`)
      }
      bytes = Buffer.alloc(current.size)
      let offset = 0
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (read.bytesRead === 0) break
        offset += read.bytesRead
      }
      if (offset !== bytes.length) bytes = bytes.subarray(0, offset)
    } finally {
      await handle.close()
    }

    const extracted = extractOfficeDocumentBytes(bytes, extension.slice(1) as 'docx' | 'xlsx', args, context.signal)
    return { root: grant.label, path: relative, format: extension.slice(1) as 'docx' | 'xlsx', bytes: info.size, ...extracted }
  }
}

export type OfficeBufferOutput = Omit<OfficeDocumentOutput, 'root' | 'path' | 'format' | 'bytes'>

/** Extract bounded text from an Office ZIP document already held in memory. */
export function extractOfficeDocumentBytes(
  source: Uint8Array,
  extension: 'docx' | 'xlsx',
  args: OfficeExtractionOptions = {},
  signal?: AbortSignal
): OfficeBufferOutput {
  const bytes = Buffer.from(source)
  if (bytes.length > MAX_ARCHIVE_BYTES) {
    throw new ToolError(`That document is larger than the ${MAX_ARCHIVE_BYTES / 1_000_000} MB limit.`)
  }
  if (extension === 'docx' && (args.startRow !== undefined || args.startSheet !== undefined || args.maxRows !== undefined || args.maxSheets !== undefined)) {
    throw new ToolError('Excel row and sheet ranges can only be used with .xlsx workbooks.')
  }
  if (extension === 'xlsx' && args.startChar !== undefined) {
    throw new ToolError('The character continuation offset can only be used with .docx documents.')
  }
  if (signal?.aborted) throw new ToolError('Document reading was cancelled.')
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new ToolError('That file is not a supported Office ZIP document.')
  }

  const entries = readZipDirectory(bytes)
  const budget: ExtractionBudget = { remaining: MAX_TOTAL_XML_BYTES }
  const maxChars = args.maxChars ?? DEFAULT_MAX_CHARS
  const extracted = extension === 'docx'
    ? extractDocx(entries, bytes, budget, args.startChar ?? 0, maxChars)
    : extractXlsx(entries, bytes, budget, args, maxChars)
  if (signal?.aborted) throw new ToolError('Document reading was cancelled.')
  const hasExtractableText = extracted.text.replace(/^--- .+ ---$/gm, '').trim().length > 0

  return {
    text: extracted.text,
    truncated: extracted.truncated,
    hasExtractableText,
    note: hasExtractableText ? extracted.note : `${extracted.note} No extractable text values were found.`,
    ...('totalSheets' in extracted ? {
      totalSheets: extracted.totalSheets,
      startSheet: extracted.startSheet,
      sheetsRead: extracted.sheetsRead,
      sheetRanges: extracted.sheetRanges,
      ...(extracted.nextSheet === undefined ? {} : { nextSheet: extracted.nextSheet })
    } : {
      totalChars: extracted.totalChars,
      startChar: extracted.startChar,
      charsRead: extracted.charsRead,
      ...(extracted.nextChar === undefined ? {} : { nextChar: extracted.nextChar })
    })
  }
}

function extractDocx(
  entries: Map<string, ZipEntry>,
  archive: Buffer,
  budget: ExtractionBudget,
  startChar: number,
  maxChars: number
): {
  text: string
  truncated: boolean
  note: string
  totalChars: number
  startChar: number
  charsRead: number
  nextChar?: number
} {
  const documentXml = readXmlPart(entries, archive, 'word/document.xml', budget, MAX_PART_BYTES)
  assertSafeXml(documentXml, 'Word document')
  if (!/<(?:[\w.-]+:)?document\b/i.test(documentXml) || !/<(?:[\w.-]+:)?body\b/i.test(documentXml)) {
    throw new ToolError('The Word document body is malformed or missing.')
  }

  const paragraphs = documentXml.matchAll(/<(?:[\w.-]+:)?p\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?p\s*>/gi)
  const sections: string[] = []
  for (const match of paragraphs) {
    const text = extractWordParagraph(match[1] ?? '')
    if (text.trim()) sections.push(text)
  }
  const fullText = sections.join('\n\n')
  if (startChar > fullText.length) {
    throw new ToolError(`This Word document has ${fullText.length} extracted characters.`)
  }
  const text = fullText.slice(startChar, startChar + maxChars)
  const nextChar = startChar + text.length
  const truncated = nextChar < fullText.length
  return {
    text,
    truncated,
    note: 'Word body text only; headers, comments, embedded files, and image text may not be included.',
    totalChars: fullText.length,
    startChar,
    charsRead: text.length,
    ...(truncated ? { nextChar } : {})
  }
}

function extractXlsx(
  entries: Map<string, ZipEntry>,
  archive: Buffer,
  budget: ExtractionBudget,
  args: OfficeExtractionOptions,
  maxChars: number
): {
  text: string
  truncated: boolean
  note: string
  totalSheets: number
  startSheet: number
  sheetsRead: number
  sheetRanges: NonNullable<OfficeDocumentOutput['sheetRanges']>
  nextSheet?: number
} {
  const workbookXml = readXmlPart(entries, archive, 'xl/workbook.xml', budget, 1_000_000)
  const relationshipsXml = readXmlPart(entries, archive, 'xl/_rels/workbook.xml.rels', budget, 1_000_000)
  assertSafeXml(workbookXml, 'Excel workbook')
  assertSafeXml(relationshipsXml, 'Excel workbook relationships')
  if (!/<(?:[\w.-]+:)?workbook\b/i.test(workbookXml)) {
    throw new ToolError('The Excel workbook manifest is malformed or missing.')
  }

  const relationships = new Map<string, { target: string; external: boolean }>()
  for (const match of relationshipsXml.matchAll(/<(?:[\w.-]+:)?Relationship\b([^>]*?)\s*\/?>/gi)) {
    const attributes = parseAttributes(match[1] ?? '')
    const id = namespacedAttribute(attributes, 'id')
    const target = attributes.Target
    if (id && target) {
      relationships.set(id, {
        target,
        external: attributes.TargetMode?.toLowerCase() === 'external'
      })
    }
  }

  const sheets = [...workbookXml.matchAll(/<(?:[\w.-]+:)?sheet\b([^>]*?)\s*\/?>/gi)]
    .map((match) => {
      const attributes = parseAttributes(match[1] ?? '')
      const id = namespacedAttribute(attributes, 'id')
      const relationship = id ? relationships.get(id) : undefined
      if (!attributes.name || !relationship) throw new ToolError('An Excel sheet has a missing relationship.')
      if (relationship.external) throw new ToolError('External worksheet references are not supported.')
      return { name: attributes.name, target: resolveWorksheetTarget(relationship.target) }
    })

  if (sheets.length === 0) throw new ToolError('The Excel workbook does not contain any worksheets.')
  const startSheet = args.startSheet ?? 1
  if (startSheet > sheets.length) {
    throw new ToolError(`This workbook has ${sheets.length} worksheet${sheets.length === 1 ? '' : 's'}.`)
  }

  const sharedStrings = entries.has('xl/sharedStrings.xml')
    ? extractSharedStrings(readXmlPart(entries, archive, 'xl/sharedStrings.xml', budget, MAX_PART_BYTES))
    : []
  const maxSheets = args.maxSheets ?? 4
  const startRow = args.startRow ?? 1
  const maxRows = args.maxRows ?? DEFAULT_MAX_ROWS
  const selectedSheets = sheets.slice(startSheet - 1, startSheet - 1 + maxSheets)
  const sheetRanges: NonNullable<OfficeDocumentOutput['sheetRanges']> = []
  let text = ''
  let nextSheet: number | undefined
  for (let index = 0; index < selectedSheets.length; index += 1) {
    const { name, target } = selectedSheets[index]!
    const sheetNumber = startSheet + index
    const sheetXml = readXmlPart(entries, archive, target, budget, 4_000_000)
    assertSafeXml(sheetXml, `Worksheet ${name}`)
    const rows = extractWorksheetRows(sheetXml, sharedStrings)
    const header = `--- Sheet: ${name} ---`
    const separator = text.length > 0 ? '\n\n' : ''
    if (header.length > maxChars) {
      throw new ToolError(`Worksheet name ${name} is longer than the ${maxChars}-character output limit.`)
    }
    if (text.length + separator.length + header.length > maxChars) {
      nextSheet = sheetNumber
      break
    }
    text += separator + header

    const endRow = Math.min(rows.length + 1, startRow + maxRows)
    let rowsRead = 0
    let rowLimitReached = false
    for (let ordinal = startRow; ordinal < endRow; ordinal += 1) {
      const row = rows[ordinal - 1]
      if (row === undefined) break
      const rowSeparator = '\n'
      if (text.length + rowSeparator.length + row.length > maxChars) {
        if (row.length + header.length + 1 > maxChars) {
          throw new ToolError(`Worksheet ${name} row ${ordinal} is longer than the ${maxChars}-character output limit. Increase maxChars up to 6,000 or shorten that row before reading it.`)
        }
        rowLimitReached = true
        break
      }
      text += rowSeparator + row
      rowsRead += 1
    }
    const nextRow = startRow + rowsRead
    const hasMoreRows = nextRow <= rows.length
    sheetRanges.push({
      sheet: sheetNumber,
      name,
      totalRows: rows.length,
      startRow,
      rowsRead,
      ...(hasMoreRows ? { nextRow } : {})
    })

    if (hasMoreRows || rowLimitReached) {
      nextSheet = sheetNumber
      break
    }
  }
  if (nextSheet === undefined && startSheet - 1 + sheetRanges.length < sheets.length) {
    nextSheet = startSheet + sheetRanges.length
  }

  return {
    text,
    truncated: nextSheet !== undefined,
    note: 'Excel row cursors count non-empty rows; displayed row numbers are the original worksheet row numbers. Values have no number/date formatting. Formula results use cached values when present; macros are not run.',
    totalSheets: sheets.length,
    startSheet,
    sheetsRead: sheetRanges.length,
    sheetRanges,
    ...(nextSheet === undefined ? {} : { nextSheet })
  }
}

function readZipDirectory(archive: Buffer): Map<string, ZipEntry> {
  const eocd = findEndOfCentralDirectory(archive)
  if (eocd < 0) throw new ToolError('The Office document ZIP directory is missing.')

  const disk = uint16(archive, eocd + 4)
  const directoryDisk = uint16(archive, eocd + 6)
  const diskEntries = uint16(archive, eocd + 8)
  const totalEntries = uint16(archive, eocd + 10)
  const directorySize = uint32(archive, eocd + 12)
  const directoryOffset = uint32(archive, eocd + 16)
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== totalEntries) {
    throw new ToolError('Multi-disk Office archives are not supported.')
  }
  if (totalEntries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new ToolError('ZIP64 Office documents are not supported.')
  }
  if (totalEntries > MAX_ARCHIVE_ENTRIES || directoryOffset + directorySize > eocd) {
    throw new ToolError('The Office document ZIP directory is invalid or too large.')
  }

  const entries = new Map<string, ZipEntry>()
  let offset = directoryOffset
  const directoryEnd = directoryOffset + directorySize
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > directoryEnd || uint32(archive, offset) !== 0x02014b50) {
      throw new ToolError('The Office document ZIP directory is malformed.')
    }
    const flags = uint16(archive, offset + 8)
    const method = uint16(archive, offset + 10)
    const crc = uint32(archive, offset + 16)
    const compressedSize = uint32(archive, offset + 20)
    const uncompressedSize = uint32(archive, offset + 24)
    const nameLength = uint16(archive, offset + 28)
    const extraLength = uint16(archive, offset + 30)
    const commentLength = uint16(archive, offset + 32)
    const localHeaderOffset = uint32(archive, offset + 42)
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength
    if (nextOffset > directoryEnd || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new ToolError('The Office document ZIP entry is invalid or uses ZIP64.')
    }

    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || path.posix.normalize(name) !== name) {
      throw new ToolError('The Office document contains an invalid ZIP entry name.')
    }
    if (entries.has(name)) throw new ToolError('The Office document has duplicate ZIP entry names.')
    entries.set(name, { name, flags, method, crc, compressedSize, uncompressedSize, localHeaderOffset })
    offset = nextOffset
  }
  return entries
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const firstPossible = Math.max(0, archive.length - 65_557)
  for (let offset = archive.length - 22; offset >= firstPossible; offset -= 1) {
    if (archive.readUInt32LE(offset) !== 0x06054b50) continue
    const commentLength = uint16(archive, offset + 20)
    if (offset + 22 + commentLength === archive.length) return offset
  }
  return -1
}

function readXmlPart(
  entries: Map<string, ZipEntry>,
  archive: Buffer,
  name: string,
  budget: ExtractionBudget,
  perPartLimit: number
): string {
  const entry = entries.get(name)
  if (!entry) throw new ToolError(`The Office document is missing ${name}.`)
  if (entry.uncompressedSize > perPartLimit || entry.uncompressedSize > budget.remaining) {
    throw new ToolError(`The Office document part ${name} exceeds the extraction limit.`)
  }
  if (entry.flags & 1) throw new ToolError('Encrypted Office documents are not supported.')
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ToolError(`The Office document uses unsupported ZIP compression for ${name}.`)
  }

  const header = entry.localHeaderOffset
  if (header + 30 > archive.length || uint32(archive, header) !== 0x04034b50) {
    throw new ToolError(`The Office document entry ${name} has an invalid local header.`)
  }
  const localFlags = uint16(archive, header + 6)
  const localMethod = uint16(archive, header + 8)
  const nameLength = uint16(archive, header + 26)
  const extraLength = uint16(archive, header + 28)
  const localName = archive.subarray(header + 30, header + 30 + nameLength).toString('utf8')
  const dataOffset = header + 30 + nameLength + extraLength
  const dataEnd = dataOffset + entry.compressedSize
  if (localFlags !== entry.flags || localMethod !== entry.method || localName !== name || dataEnd > archive.length) {
    throw new ToolError(`The Office document entry ${name} has an invalid local header.`)
  }

  let data: Buffer
  try {
    const compressed = archive.subarray(dataOffset, dataEnd)
    data = entry.method === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: perPartLimit })
  } catch {
    throw new ToolError(`The Office document part ${name} is invalid or exceeds its extraction limit.`)
  }
  if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc) {
    throw new ToolError(`The Office document part ${name} failed its integrity check.`)
  }
  budget.remaining -= data.length
  return data.toString('utf8')
}

function extractWordParagraph(xml: string): string {
  const tokens = /<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t\s*>|<(?:[\w.-]+:)?(tab|br|cr)\b[^>]*\/\s*>/gi
  let text = ''
  for (const match of xml.matchAll(tokens)) {
    text += match[1] !== undefined ? decodeXmlText(match[1]) : match[2] === 'tab' ? '\t' : '\n'
  }
  return text.trim()
}

function extractSharedStrings(xml: string): string[] {
  assertSafeXml(xml, 'Excel shared strings')
  const strings: string[] = []
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?si\s*>/gi)) {
    strings.push(extractXmlText(match[1] ?? ''))
  }
  return strings
}

function extractWorksheetRows(xml: string, sharedStrings: string[]): string[] {
  const output: string[] = []
  const rows = /<(?:[\w.-]+:)?row\b([^>]*?)(?:\s*\/\s*>|>([\s\S]*?)<\/(?:[\w.-]+:)?row\s*>)/gi
  const cells = /<(?:[\w.-]+:)?c\b([^>]*?)(?:\s*\/\s*>|>([\s\S]*?)<\/(?:[\w.-]+:)?c\s*>)/gi
  for (const row of xml.matchAll(rows)) {
    const rowAttributes = parseAttributes(row[1] ?? '')
    const values: string[] = []
    for (const cell of (row[2] ?? '').matchAll(cells)) {
      const attributes = parseAttributes(cell[1] ?? '')
      const value = cellValue(cell[2] ?? '', attributes.t ?? '', sharedStrings)
      if (!value) continue
      const reference = attributes.r ?? `cell-${values.length + 1}`
      values.push(`${reference}=${value.replace(/[\t\r\n]+/g, ' ')}`)
    }
    if (values.length > 0) output.push(`Row ${rowAttributes.r ?? '?'}: ${values.join(' | ')}`)
  }
  return output
}

function cellValue(xml: string, type: string, sharedStrings: string[]): string {
  if (type === 'inlineStr') return extractXmlText(xml)
  const valueMatch = xml.match(/<(?:[\w.-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v\s*>/i)
  const rawValue = valueMatch ? decodeXmlText(valueMatch[1] ?? '') : ''
  if (type === 's') {
    const index = Number.parseInt(rawValue, 10)
    return Number.isInteger(index) ? (sharedStrings[index] ?? '') : ''
  }
  if (type === 'b') return rawValue === '1' ? 'TRUE' : rawValue === '0' ? 'FALSE' : rawValue
  if (type === 'e') return rawValue ? `ERROR ${rawValue}` : ''
  if (rawValue) return rawValue
  const formula = xml.match(/<(?:[\w.-]+:)?f\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?f\s*>/i)
  return formula ? `=${decodeXmlText(formula[1] ?? '')}` : ''
}

function extractXmlText(xml: string): string {
  const chunks: string[] = []
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t\s*>/gi)) {
    chunks.push(decodeXmlText(match[1] ?? ''))
  }
  return chunks.join('')
}

function resolveWorksheetTarget(target: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) {
    throw new ToolError('External worksheet references are not supported.')
  }
  const rooted = target.startsWith('/')
    ? target.slice(1)
    : target.startsWith('xl/')
      ? target
      : path.posix.join('xl', target)
  const normalized = path.posix.normalize(rooted)
  if (!normalized.startsWith('xl/worksheets/') || normalized.includes('../')) {
    throw new ToolError('An Excel worksheet path is outside the workbook worksheet folder.')
  }
  return normalized
}

function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1] ?? ''] = decodeXmlText(match[2] ?? match[3] ?? '')
  }
  return attributes
}

function namespacedAttribute(attributes: Record<string, string>, name: string): string | undefined {
  const normalizedName = name.toLowerCase()
  const entry = Object.entries(attributes).find(([key]) => {
    const normalizedKey = key.toLowerCase()
    return normalizedKey === normalizedName || normalizedKey.endsWith(`:${normalizedName}`)
  })
  return entry?.[1]
}

function assertSafeXml(xml: string, description: string): void {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new ToolError(`${description} contains unsupported XML declarations.`)
  }
}

function decodeXmlText(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, token: string) => {
    const lower = token.toLowerCase()
    if (lower === 'amp') return '&'
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'quot') return '"'
    if (lower === 'apos') return "'"
    const codePoint = lower.startsWith('#x')
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10)
    const validXmlCodePoint = codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    return Number.isInteger(codePoint) && validXmlCodePoint
      ? String.fromCodePoint(codePoint)
      : whole
  })
}

function uint16(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > buffer.length) throw new ToolError('The Office document ZIP structure is truncated.')
  return buffer.readUInt16LE(offset)
}

function uint32(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buffer.length) throw new ToolError('The Office document ZIP structure is truncated.')
  return buffer.readUInt32LE(offset)
}

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let value = n
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  CRC_TABLE[n] = value >>> 0
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0)
  return (crc ^ 0xffffffff) >>> 0
}
