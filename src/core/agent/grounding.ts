import type { ToolCall, ToolResult } from '../../shared/types'
import type { GrantStore } from '../grants'

/**
 * Sent once when a model describes an action instead of performing it. It is a
 * harness message, not something the user typed, so it is never rendered.
 */
export const NUDGE_TEXT =
  'You described an action but did not call any tool, so nothing happened. ' +
  'If the task still needs a file to be created, changed, read, or listed, call the tool now. ' +
  'Otherwise give your final answer and do not mention future actions.'

const ACTION_PROMISE =
  /\b(i will|i'll|i am going to|i'm going to|let me|now i(?:'ll| will)|next,? i(?:'ll| will)|i(?:'m| am) now|i can (?:now )?(?:create|write|save)|i(?: have|'ve)? (?:created|written|saved|updated|modified|recorded|logged))\b/i

export const SUMMARY_SOURCE_NUDGE =
  'Before answering a request to summarize files, list the requested approved folder and read every listed text, PDF, Word, or Excel source with the matching reader. ' +
  'For truncated folder listings, continue with list_dir at startIndex=nextIndex. ' +
  'For truncated text files, continue with startByte=nextByte; for truncated PDFs, continue with startPage=nextPage and startChar=nextChar; for truncated Office files, continue from nextChar, nextRow, or nextSheet until the reader reports the full file was read. ' +
  'A filename is not evidence of its contents. After reading, create or save the requested summary with write_file if asked.'

export const WRITE_TOOL_NUDGE =
  'You said you would make a change, but no write tool succeeded, so nothing was changed. ' +
  'Call the appropriate write tool now if the user requested a change, or plainly explain what is missing.'

const SUMMARY_SOURCE_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.rst', '.csv', '.tsv', '.json', '.yaml', '.yml',
  '.xml', '.html', '.htm', '.log', '.ini', '.toml', '.pdf', '.docx', '.xlsx'
])

export interface SummaryReadGuard {
  required: boolean
  writeRequired: boolean
  writeCompleted: boolean
  requiredWriteTool: 'file' | null
  listingSeen: boolean
  listingProgress: Map<string, DirectoryListProgress>
  listingCompleted: Set<string>
  listingInvalid: Set<string>
  expected: Set<string>
  completed: Set<string>
  textProgress: Map<string, TextReadProgress>
  officeProgress: Map<string, OfficeReadProgress>
  pdfProgress: Map<string, PdfReadProgress>
}

export interface ProjectReviewGuard {
  required: boolean
  overviewSeen: boolean
  expected: Set<string>
  completed: Set<string>
  textProgress: Map<string, TextReadProgress>
  officeProgress: Map<string, OfficeReadProgress>
  pdfProgress: Map<string, PdfReadProgress>
}

interface OfficeReadProgress {
  format?: 'docx' | 'xlsx'
  nextChar: number
  totalChars?: number
  nextSheet: number
  nextRow: number
  totalSheets?: number
}

interface PdfReadProgress {
  nextPage: number
  nextChar: number
  totalPages?: number
}

interface TextReadProgress {
  nextByte: number
  totalBytes?: number
}

interface DirectoryListProgress {
  nextIndex: number
  totalEntries: number
}

export function promisesAction(text: string): boolean {
  return ACTION_PROMISE.test(text)
}

export function summaryReadGuard(text: string): SummaryReadGuard {
  const asksForSummary = /\b(summar(?:y|ies|ize|ise|ized|ised|izing|ising))\b/i.test(text)
  const namesFiles = /\b(files?|documents?|folder|directory)\b/i.test(text)
  const writeVerbs = '(?:create|write|save|edit|update|modify|append|overwrite|creating|writing|saving|editing|updating|modifying|appending|overwriting)'
  const explicitlyAvoidsFileWrite = new RegExp(
    `\\b(?:do not|don't|dont|never|avoid)\\b(?:\\s+\\w+){0,3}\\s+${writeVerbs}\\b`,
    'i'
  ).test(text)
  const asksForFileWrite = !explicitlyAvoidsFileWrite &&
    /\b(create|write|save|edit|update|modify|append|overwrite)\b/i.test(text) &&
    /\b(notes?|summaries|summary|reports?|files?|documents?)\b|\.(?:md|txt|markdown)\b/i.test(text)

  return {
    required: asksForSummary && namesFiles,
    writeRequired: asksForFileWrite,
    writeCompleted: false,
    requiredWriteTool: asksForFileWrite ? 'file' : null,
    listingSeen: false,
    listingProgress: new Map(),
    listingCompleted: new Set(),
    listingInvalid: new Set(),
    expected: new Set(),
    completed: new Set(),
    textProgress: new Map(),
    officeProgress: new Map(),
    pdfProgress: new Map()
  }
}

export function projectReviewGuard(text: string, forceReview = false): ProjectReviewGuard {
  const reviewIntent = /\b(review|reviewed|reviewing|check|checked|audit|audited|inspect|inspected|assess|assessed|look over)\b/i.test(text)
  const projectSubject = /\b(project|codebase|repository|repo|source code)\b/i.test(text)
  const requestsChanges =
    /\b(?:fix|change|edit|modify|rewrite|implement|refactor)\s+(?:the|this|my|these|those|any|files?|code|project|bugs?|issues?)\b/i.test(text)
  return {
    required: forceReview || (reviewIntent && projectSubject && !requestsChanges),
    overviewSeen: false,
    expected: new Set(),
    completed: new Set(),
    textProgress: new Map(),
    officeProgress: new Map(),
    pdfProgress: new Map()
  }
}

export function isBrainstormRequest(text: string): boolean {
  return /\bbrainstorm(?:ing)?\b|\bbrainstorm partner\b|\bideas for\b/i.test(text)
}

function relativeKey(rootId: string, relative: string): string {
  const normalized = relative.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
  return `${rootId}:${normalized.toLowerCase()}`
}

function isSummarizableFile(name: string): boolean {
  const extension = name.match(/\.[^.]+$/)?.[0]?.toLowerCase()
  return Boolean(extension && SUMMARY_SOURCE_EXTENSIONS.has(extension))
}

function advanceOfficeRead(
  progressByFile: Map<string, OfficeReadProgress>,
  fileKey: string,
  args: Record<string, unknown>,
  rawOutput: unknown
): boolean {
  if (!rawOutput || typeof rawOutput !== 'object') return false
  const output = rawOutput as Record<string, unknown>
  const format = output.format
  if (format !== 'docx' && format !== 'xlsx') return false

  const previous = progressByFile.get(fileKey)
  const progress: OfficeReadProgress = previous
    ? { ...previous }
    : { nextChar: 0, nextSheet: 1, nextRow: 1 }
  if (progress.format && progress.format !== format) return false
  progress.format = format

  if (format === 'docx') {
    const requestedStart = typeof args.startChar === 'number' ? args.startChar : 0
    const startChar = output.startChar
    const charsRead = output.charsRead
    const totalChars = output.totalChars
    if (
      !Number.isInteger(startChar) || !Number.isInteger(charsRead) || !Number.isInteger(totalChars) ||
      startChar !== requestedStart || requestedStart !== progress.nextChar ||
      (progress.totalChars !== undefined && progress.totalChars !== totalChars) ||
      typeof output.truncated !== 'boolean'
    ) return false
    const endChar = (startChar as number) + (charsRead as number)
    if (endChar > (totalChars as number)) return false
    progress.totalChars = totalChars as number
    if (output.truncated) {
      if (output.nextChar !== endChar || endChar <= requestedStart) return false
      progress.nextChar = endChar
      progressByFile.set(fileKey, progress)
      return false
    }
    if (endChar !== totalChars) return false
    progressByFile.delete(fileKey)
    return true
  }

  const requestedSheet = typeof args.startSheet === 'number' ? args.startSheet : 1
  const requestedRow = typeof args.startRow === 'number' ? args.startRow : 1
  const totalSheets = output.totalSheets
  const startSheet = output.startSheet
  const ranges = output.sheetRanges
  if (
    !Number.isInteger(totalSheets) || !Number.isInteger(startSheet) || !Array.isArray(ranges) ||
    !Number.isInteger(output.sheetsRead) || output.sheetsRead !== ranges.length ||
    requestedSheet !== progress.nextSheet || requestedRow !== progress.nextRow || startSheet !== requestedSheet ||
    (progress.totalSheets !== undefined && progress.totalSheets !== totalSheets) ||
    typeof output.truncated !== 'boolean'
  ) return false
  progress.totalSheets = totalSheets as number

  for (const rawRange of ranges) {
    if (!rawRange || typeof rawRange !== 'object') return false
    const range = rawRange as Record<string, unknown>
    const sheet = range.sheet
    const startRow = range.startRow
    const rowsRead = range.rowsRead
    const rowsTotal = range.totalRows
    if (
      !Number.isInteger(sheet) || !Number.isInteger(startRow) || !Number.isInteger(rowsRead) ||
      !Number.isInteger(rowsTotal) || sheet !== progress.nextSheet || startRow !== progress.nextRow ||
      (rowsRead as number) < 0 || (rowsTotal as number) < 0
    ) return false
    const followingRow = (startRow as number) + (rowsRead as number)
    if (typeof range.nextRow === 'number') {
      if (!Number.isInteger(range.nextRow) || range.nextRow !== followingRow || followingRow > (rowsTotal as number)) return false
      progress.nextRow = followingRow
      continue
    }
    if (followingRow <= (rowsTotal as number)) return false
    progress.nextSheet = (sheet as number) + 1
    progress.nextRow = 1
  }

  if (output.nextSheet !== undefined) {
    if (!Number.isInteger(output.nextSheet) || output.nextSheet !== progress.nextSheet || !output.truncated) return false
    progressByFile.set(fileKey, progress)
    return false
  }
  if (output.truncated || progress.nextSheet !== (totalSheets as number) + 1) return false
  progressByFile.delete(fileKey)
  return true
}

function advancePdfRead(
  progressByFile: Map<string, PdfReadProgress>,
  fileKey: string,
  args: Record<string, unknown>,
  rawOutput: unknown
): boolean {
  if (!rawOutput || typeof rawOutput !== 'object') return false
  const output = rawOutput as Record<string, unknown>
  const previous = progressByFile.get(fileKey)
  const progress = previous ? { ...previous } : { nextPage: 1, nextChar: 0 }
  const requestedPage = typeof args.startPage === 'number' ? args.startPage : 1
  const requestedChar = typeof args.startChar === 'number' ? args.startChar : 0
  const totalPages = output.totalPages
  const startPage = output.startPage
  const startChar = output.startChar
  const pagesRead = output.pagesRead
  if (
    !Number.isInteger(totalPages) || (totalPages as number) < 1 ||
    !Number.isInteger(startPage) || startPage !== requestedPage || startPage !== progress.nextPage ||
    !Number.isInteger(startChar) || startChar !== requestedChar || startChar !== progress.nextChar ||
    !Number.isInteger(pagesRead) || (pagesRead as number) < 1 ||
    (progress.totalPages !== undefined && progress.totalPages !== totalPages) ||
    typeof output.truncated !== 'boolean'
  ) return false
  progress.totalPages = totalPages as number

  if (output.truncated) {
    const nextPage = output.nextPage
    const nextChar = output.nextChar
    if (
      !Number.isInteger(nextPage) || !Number.isInteger(nextChar) ||
      (nextPage as number) < requestedPage || (nextPage as number) > (totalPages as number) ||
      (nextChar as number) < 0
    ) return false
    const expectedPagesRead = (nextPage as number) - requestedPage + ((nextChar as number) > 0 ? 1 : 0)
    if ((pagesRead as number) !== expectedPagesRead) return false
    if (nextPage === requestedPage && (nextChar as number) <= requestedChar) return false
    if (nextPage === requestedPage && (pagesRead as number) !== 1) return false
    progress.nextPage = nextPage as number
    progress.nextChar = nextChar as number
    progressByFile.set(fileKey, progress)
    return false
  }

  if (
    output.nextPage !== undefined || output.nextChar !== undefined ||
    requestedPage + (pagesRead as number) - 1 !== totalPages
  ) return false
  progressByFile.delete(fileKey)
  return true
}

function advanceTextRead(
  progressByFile: Map<string, TextReadProgress>,
  fileKey: string,
  args: Record<string, unknown>,
  rawOutput: unknown
): boolean {
  if (!rawOutput || typeof rawOutput !== 'object') return false
  const output = rawOutput as Record<string, unknown>
  const previous = progressByFile.get(fileKey)
  const progress = previous ? { ...previous } : { nextByte: 0 }
  const requestedStart = typeof args.startByte === 'number' ? args.startByte : 0
  const startByte = output.startByte
  const bytesRead = output.bytesRead
  const totalBytes = output.bytes
  if (
    !Number.isInteger(startByte) || startByte !== requestedStart || startByte !== progress.nextByte ||
    !Number.isInteger(bytesRead) || (bytesRead as number) < 0 ||
    !Number.isInteger(totalBytes) || (totalBytes as number) < 0 ||
    (progress.totalBytes !== undefined && progress.totalBytes !== totalBytes) ||
    typeof output.truncated !== 'boolean'
  ) return false
  const nextByte = (startByte as number) + (bytesRead as number)
  if (nextByte > (totalBytes as number)) return false
  progress.totalBytes = totalBytes as number

  if (output.truncated) {
    if (
      !Number.isInteger(output.nextByte) || output.nextByte !== nextByte ||
      nextByte <= requestedStart || nextByte >= (totalBytes as number)
    ) return false
    progress.nextByte = nextByte
    progressByFile.set(fileKey, progress)
    return false
  }

  if (output.nextByte !== undefined || nextByte !== totalBytes) return false
  progressByFile.delete(fileKey)
  return true
}

export function recordSummarySource(
  guard: SummaryReadGuard,
  grants: GrantStore,
  call: ToolCall,
  result: ToolResult
): void {
  if (
    call.risk === 'write' &&
    result.ok &&
    (guard.requiredWriteTool === null ||
      (guard.requiredWriteTool === 'file' && ['write_file', 'create_note', 'create_email_draft', 'create_calendar_event'].includes(call.name)))
  ) guard.writeCompleted = true
  if (!guard.required || !result.ok) return
  const args = (call.args && typeof call.args === 'object' ? call.args : {}) as Record<string, unknown>

  try {
    const grant = grants.get(typeof args.root === 'string' ? args.root : undefined)
    if (call.name === 'list_dir') {
      const output = result.output as {
        path?: unknown
        entries?: Array<{ name?: unknown; type?: unknown }>
        startIndex?: unknown
        totalEntries?: unknown
        nextIndex?: unknown
        truncated?: unknown
      } | undefined
      const directory = typeof output?.path === 'string' && output.path !== '.' ? output.path : ''
      const listingKey = relativeKey(grant.id, directory)
      const pageEntries = output?.entries ?? []

      if (
        typeof output?.startIndex === 'number' && typeof output.totalEntries === 'number' &&
        typeof output.truncated === 'boolean'
      ) {
        const requestedStart = typeof args.startIndex === 'number' ? args.startIndex : 0
        if (requestedStart === 0) {
          guard.listingProgress.delete(listingKey)
          guard.listingCompleted.delete(listingKey)
          guard.listingInvalid.delete(listingKey)
        }
        const progress = guard.listingProgress.get(listingKey)
        const expectedStart = progress?.nextIndex ?? 0
        const nextIndex = output.startIndex + pageEntries.length
        const validPage = Number.isInteger(output.startIndex) && Number.isInteger(output.totalEntries) &&
          output.startIndex === requestedStart && requestedStart === expectedStart &&
          output.totalEntries >= 0 && output.startIndex <= output.totalEntries &&
          nextIndex <= output.totalEntries &&
          (output.truncated
            ? Number.isInteger(output.nextIndex) && output.nextIndex === nextIndex && nextIndex > requestedStart && nextIndex < output.totalEntries
            : output.nextIndex === undefined && nextIndex === output.totalEntries)

        if (validPage) {
          if (output.truncated) {
            guard.listingProgress.set(listingKey, { nextIndex, totalEntries: output.totalEntries })
          } else {
            guard.listingProgress.delete(listingKey)
            guard.listingCompleted.add(listingKey)
          }
        } else {
          guard.listingProgress.delete(listingKey)
          guard.listingCompleted.delete(listingKey)
          guard.listingInvalid.add(listingKey)
        }
        guard.listingSeen = guard.listingCompleted.size > 0 &&
          guard.listingProgress.size === 0 && guard.listingInvalid.size === 0
      } else {
        guard.listingCompleted.add(listingKey)
        guard.listingSeen = guard.listingProgress.size === 0 && guard.listingInvalid.size === 0
      }

      for (const entry of pageEntries) {
        if (entry.type !== 'file' || typeof entry.name !== 'string' || !isSummarizableFile(entry.name)) {
          continue
        }
        const relative = directory ? `${directory.replace(/[\\/]+$/, '')}/${entry.name}` : entry.name
        guard.expected.add(relativeKey(grant.id, relative))
      }
    } else if (
      (call.name === 'read_file' || call.name === 'read_pdf' || call.name === 'read_office_document') &&
      typeof args.path === 'string'
    ) {
      const key = relativeKey(grant.id, args.path)
      const output = result.output as { truncated?: unknown } | undefined
      const complete = call.name === 'read_office_document'
        ? advanceOfficeRead(guard.officeProgress, key, args, result.output)
        : call.name === 'read_pdf' && output && typeof output === 'object' && 'truncated' in output
          ? advancePdfRead(guard.pdfProgress, key, args, result.output)
          : call.name === 'read_file' && output && typeof output === 'object' && 'bytesRead' in output
            ? advanceTextRead(guard.textProgress, key, args, result.output)
          : true
      if (complete) {
        guard.completed.add(key)
      }
    }
  } catch {
    // A successful gateway result should have a valid grant. If it does not,
    // leave the guard unsatisfied rather than allowing a summary write.
  }
}

export function summarySourcesRead(guard: SummaryReadGuard): boolean {
  if (!guard.required) return true
  return guard.listingSeen && [...guard.expected].every((file) => guard.completed.has(file))
}

export function taskActionsComplete(guard: SummaryReadGuard): boolean {
  return summarySourcesRead(guard) && (!guard.writeRequired || guard.writeCompleted)
}

export function projectReviewComplete(guard: ProjectReviewGuard): boolean {
  return !guard.required || (guard.overviewSeen && [...guard.expected].every((file) => guard.completed.has(file)))
}

export function responseCanBeShown(summary: SummaryReadGuard, project: ProjectReviewGuard): boolean {
  return taskActionsComplete(summary) && projectReviewComplete(project)
}

export function recordProjectReview(
  guard: ProjectReviewGuard,
  grants: GrantStore,
  call: ToolCall,
  result: ToolResult
): void {
  if (!guard.required || !result.ok) return
  const args = (call.args && typeof call.args === 'object' ? call.args : {}) as Record<string, unknown>
  try {
    const grant = grants.get(typeof args.root === 'string' ? args.root : undefined)
    if (call.name === 'project_overview') {
      guard.overviewSeen = true
      const output = result.output as { keyFiles?: unknown } | undefined
      const base = typeof args.path === 'string' && args.path !== '.' ? args.path : ''
      for (const keyFile of Array.isArray(output?.keyFiles) ? output.keyFiles : []) {
        if (typeof keyFile !== 'string') continue
        const relative = base ? `${base.replace(/[\\/]+$/, '')}/${keyFile}` : keyFile
        guard.expected.add(relativeKey(grant.id, relative))
      }
    } else if (
      (call.name === 'read_file' || call.name === 'read_pdf' || call.name === 'read_office_document') &&
      typeof args.path === 'string'
    ) {
      const key = relativeKey(grant.id, args.path)
      const output = result.output as { truncated?: unknown } | undefined
      const complete = call.name === 'read_office_document'
        ? advanceOfficeRead(guard.officeProgress, key, args, result.output)
        : call.name === 'read_pdf' && output && typeof output === 'object' && 'truncated' in output
          ? advancePdfRead(guard.pdfProgress, key, args, result.output)
          : call.name === 'read_file' && output && typeof output === 'object' && 'bytesRead' in output
            ? advanceTextRead(guard.textProgress, key, args, result.output)
          : true
      if (complete) {
        guard.completed.add(key)
      }
    }
  } catch {
    // If a grant cannot be reconciled, keep the review guard unsatisfied.
  }
}

export function projectReviewWriteBlock(guard: ProjectReviewGuard, risk?: ToolCall['risk']): string | null {
  if (!guard.required || (risk !== 'write' && risk !== 'command')) return null
  return 'This project review is read-only. No files will be changed; ask separately if you want a fix.'
}

export function summaryWriteBlock(guard: SummaryReadGuard, risk?: ToolCall['risk']): string | null {
  if (risk !== 'write' && risk !== 'command') return null
  if (!guard.required || summarySourcesRead(guard)) return null
  if (!guard.listingSeen) {
    if (guard.listingProgress.size > 0) {
      return 'The source folder listing is incomplete. Continue list_dir from startIndex=nextIndex before writing the summary.'
    }
    if (guard.listingInvalid.size > 0) {
      return 'The source folder listing was out of order. Restart list_dir at startIndex=0 before writing the summary.'
    }
    return 'List the source folder before writing a file summary.'
  }

  const pending = [...guard.expected].filter((file) => !guard.completed.has(file))
  const labels = pending.map((file) => {
    const separator = file.indexOf(':')
    return file.slice(separator + 1)
  })
  const list = labels.length ? ` Read these files first: ${labels.join(', ')}.` : ''
  return `I have not read the source text yet, so I will not write a summary based on filenames alone.${list}`
}
