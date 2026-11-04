import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { z } from 'zod'
import type { ToolDef } from '../shared/types'
import { pathContext, resolveGrantPath, ToolError } from './paths'

const rootField = z.string().optional().describe('Approved folder to use. Omit for the primary workspace.')
const MAX_PDF_BYTES = 25_000_000
const DEFAULT_MAX_CHARS = 5_000

const readPdfInput = z.object({
  root: rootField,
  path: z.string().trim().min(1).describe('Relative path to a PDF inside an approved folder.'),
  startPage: z.number().int().min(1).max(100_000).optional(),
  startChar: z.number().int().min(0).max(16_000_000).optional()
    .describe('Character offset within startPage when continuing a PDF page.'),
  maxPages: z.number().int().min(1).max(20).optional(),
  maxChars: z.number().int().min(200).max(6_000).optional()
})

type ReadPdfArgs = z.infer<typeof readPdfInput>

interface ReadPdfOutput {
  root: string
  path: string
  bytes: number
  totalPages: number
  startPage: number
  startChar: number
  pagesRead: number
  nextPage?: number
  nextChar?: number
  text: string
  truncated: boolean
  hasExtractableText: boolean
  note?: string
}

export const readPdfTool: ToolDef<ReadPdfArgs, ReadPdfOutput> = {
  name: 'read_pdf',
  description:
    'Extract selectable text from a PDF inside an approved folder. Reads at most 25 MB, 20 pages, and 6,000 characters per call. Continue a truncated read with nextPage as startPage and nextChar as startChar. startChar is an offset within that page. Scanned PDFs need OCR, which is not included.',
  risk: 'read',
  timeoutMs: 45_000,
  input: readPdfInput,
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
    const pageCount = args.maxPages ?? 8
    return `Extract up to ${pageCount} pages of selectable text from ${args.path} in the approved folder.`
  },
  async run(args, context) {
    const { path: target, grant, relative } = pathContext(context)
    if (path.extname(relative).toLowerCase() !== '.pdf') {
      throw new ToolError('That file does not have a .pdf extension.')
    }

    const info = await stat(target)
    if (!info.isFile()) throw new ToolError('That path is not a regular file.')
    if (info.size > MAX_PDF_BYTES) {
      throw new ToolError(`That PDF is larger than the ${Math.round(MAX_PDF_BYTES / 1_000_000)} MB limit.`)
    }

    const handle = await open(target, 'r')
    let bytes: Buffer
    try {
      const current = await handle.stat()
      if (!current.isFile()) throw new ToolError('That path is not a regular file.')
      if (current.size > MAX_PDF_BYTES) {
        throw new ToolError(`That PDF is larger than the ${Math.round(MAX_PDF_BYTES / 1_000_000)} MB limit.`)
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

    const extracted = await extractPdfBuffer(bytes, args, context.signal)
    return { root: grant.label, path: relative, bytes: info.size, ...extracted }
  }
}

export type PdfBufferOptions = Pick<ReadPdfArgs, 'startPage' | 'startChar' | 'maxPages' | 'maxChars'>
export type PdfBufferExcerpt = Omit<ReadPdfOutput, 'root' | 'path' | 'bytes'>

/** Extract a bounded text excerpt from PDF bytes already held in memory. */
export async function extractPdfBuffer(source: Uint8Array, options: PdfBufferOptions = {}, signal?: AbortSignal): Promise<PdfBufferExcerpt> {
  const bytes = Buffer.from(source)
  if (bytes.length > MAX_PDF_BYTES) {
    throw new ToolError(`That PDF is larger than the ${Math.round(MAX_PDF_BYTES / 1_000_000)} MB limit.`)
  }
  if (!bytes.subarray(0, Math.min(bytes.length, 1_024)).includes(Buffer.from('%PDF-'))) {
    throw new ToolError('That file does not contain a PDF header.')
  }
  if (signal?.aborted) throw new ToolError('PDF reading was cancelled.')

  const loadingTask = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, useWasm: false, stopAtErrors: true, verbosity: 0 })
  const destroyOnAbort = (): void => { void loadingTask.destroy().catch(() => undefined) }
  signal?.addEventListener('abort', destroyOnAbort, { once: true })

  try {
    const document = await loadingTask.promise
    const startPage = options.startPage ?? 1
    if (startPage > document.numPages) {
      throw new ToolError(`This PDF has ${document.numPages} page${document.numPages === 1 ? '' : 's'}.`)
    }
    const maxPages = options.maxPages ?? 8
    const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
    const requestedStartChar = options.startChar ?? 0
    const endPage = Math.min(document.numPages, startPage + maxPages - 1)
    const chunks: string[] = []
    let textLength = 0
    let pagesRead = 0
    let truncated = false
    let nextPage: number | undefined
    let nextChar: number | undefined

    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      if (signal?.aborted) throw new ToolError('PDF reading was cancelled.')
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageText = content.items
        .filter((item): item is typeof item & { str: string } => 'str' in item)
        .map((item) => `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}`)
        .join('')
        .replace(/[\t ]+/g, ' ')
        .trim()
      const pageOffset = pageNumber === startPage ? requestedStartChar : 0
      if (pageOffset > pageText.length) throw new ToolError(`Page ${pageNumber} has ${pageText.length} extracted characters.`)
      const remainingPageText = pageText.slice(pageOffset)
      const prefix = `${chunks.length > 0 ? '\n\n' : ''}--- Page ${pageNumber} ---\n`
      const available = maxChars - textLength - prefix.length
      if (available < 0) {
        truncated = true
        nextPage = pageNumber
        nextChar = pageOffset
        break
      }
      const pageChunk = remainingPageText.slice(0, available)
      chunks.push(`${prefix}${pageChunk}`)
      textLength += prefix.length + pageChunk.length
      if (pageChunk.length < remainingPageText.length) {
        pagesRead += 1
        truncated = true
        nextPage = pageNumber
        nextChar = pageOffset + pageChunk.length
        break
      }
      pagesRead += 1
    }
    if (!truncated && endPage < document.numPages) {
      truncated = true
      nextPage = endPage + 1
      nextChar = 0
    }
    const text = chunks.join('')
    const hasExtractableText = text.replace(/--- Page \d+ ---/g, '').trim().length > 0
    return {
      totalPages: document.numPages,
      startPage,
      startChar: requestedStartChar,
      pagesRead,
      ...(truncated ? { nextPage, nextChar } : {}),
      text,
      truncated,
      hasExtractableText,
      ...(!hasExtractableText ? { note: 'No selectable text was found. This may be a scanned PDF; OCR is not available.' } : {})
    }
  } catch (error) {
    if (error instanceof ToolError) throw error
    if (signal?.aborted) throw new ToolError('PDF reading was cancelled.')
    const message = error instanceof Error ? error.message : String(error)
    if (/password|encrypted/i.test(message)) throw new ToolError('This PDF is password-protected and cannot be read.')
    throw new ToolError(`Could not extract text from this PDF: ${message.slice(0, 300)}`)
  } finally {
    signal?.removeEventListener('abort', destroyOnAbort)
    await loadingTask.destroy().catch(() => undefined)
  }
}
