import { randomUUID } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { ToolDef } from '../shared/types'
import { resolveGrantPath, ToolError } from './paths'
import { writeFileTool } from './fs'

interface WriteOutput {
  root: string
  path: string
  bytes: number
  created: boolean
}

interface GeneratedFileTool<A extends { root?: string }> {
  name: string
  description: string
  input: z.ZodType<A>
  relativePath: (args: A) => string
  content: (args: A) => string
}

function generatedFileTool<A extends { root?: string }>(options: GeneratedFileTool<A>): ToolDef<A, WriteOutput> {
  return {
    name: options.name,
    description: options.description,
    risk: 'write',
    input: options.input,
    async scope(args, context) {
      const grant = context.grants.get(args.root)
      const resolved = await resolveGrantPath(grant, options.relativePath(args))
      return {
        kind: 'path',
        grantId: grant.id,
        grantLabel: grant.label,
        path: resolved.path,
        relative: resolved.relative
      }
    },
    async preview(args, context) {
      const proposed = { path: options.relativePath(args), content: options.content(args) }
      return (await writeFileTool.preview?.(proposed, context)) ?? `Create ${proposed.path}`
    },
    async run(args, context) {
      return writeFileTool.run(
        { path: options.relativePath(args), content: options.content(args) },
        context
      )
    }
  }
}

const noteInput = z.object({
  root: z.string().optional().describe('Approved folder for the note; defaults to Workspace.'),
  title: z.string().trim().min(1).max(160),
  content: z.string().min(1).max(100_000),
  path: z.string().optional().describe('Optional filename under notes/, without a leading slash.')
})

type NoteArgs = z.infer<typeof noteInput>

export const createNoteTool = generatedFileTool<NoteArgs>({
  name: 'create_note',
  description: 'Create a Markdown note under notes/ in an approved folder. The write requires approval.',
  input: noteInput,
  relativePath: (args) => `notes/${safeFileName(args.path, args.title, '.md')}`,
  content: (args) => `# ${args.title.trim()}\n\n${args.content.trim()}\n`
})

const searchNotesInput = z.object({
  root: z.string().optional().describe('Approved folder to search; defaults to Workspace.'),
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(30).optional()
})

type SearchNotesArgs = z.infer<typeof searchNotesInput>

interface NoteHit {
  path: string
  excerpt: string
}

interface SearchNotesOutput {
  root: string
  query: string
  hits: NoteHit[]
  truncated: boolean
}

export const searchNotesTool: ToolDef<SearchNotesArgs, SearchNotesOutput> = {
  name: 'search_notes',
  description: 'Search Markdown and text notes under notes/ in an approved folder.',
  risk: 'read',
  input: searchNotesInput,
  async scope(args, context) {
    const grant = context.grants.get(args.root)
    const resolved = await resolveGrantPath(grant, 'notes')
    return {
      kind: 'path',
      grantId: grant.id,
      grantLabel: grant.label,
      path: resolved.path,
      relative: resolved.relative
    }
  },
  async run(args, context) {
    if (context.kind !== 'path') throw new ToolError('Note search requires a folder scope.')
    const query = args.query.toLowerCase()
    const files = await collectNoteFiles(context.path, 4, 500)
    const hits: NoteHit[] = []
    const limit = args.limit ?? 10

    for (const file of files) {
      if (hits.length >= limit) break
      try {
        const info = await stat(file.absolute)
        if (!info.isFile() || info.size > 256_000) continue
        const content = await readFile(file.absolute, 'utf8')
        const index = content.toLowerCase().indexOf(query)
        if (index < 0) continue
        const start = Math.max(0, index - 120)
        const end = Math.min(content.length, index + query.length + 180)
        const excerpt = content.slice(start, end).replace(/\s+/g, ' ').trim()
        hits.push({ path: file.relative, excerpt })
      } catch {
        // A file disappearing or becoming unreadable should not abort other hits.
      }
    }

    return {
      root: context.grant.label,
      query: args.query,
      hits,
      truncated: files.length >= 500
    }
  }
}

const emailInput = z.object({
  root: z.string().optional().describe('Approved folder for the draft; defaults to Workspace.'),
  to: z.string().trim().min(3).max(1000),
  subject: z.string().trim().min(1).max(240),
  body: z.string().max(100_000)
})

type EmailArgs = z.infer<typeof emailInput>

export const createEmailDraftTool = generatedFileTool<EmailArgs>({
  name: 'create_email_draft',
  description: 'Create an unsent .eml email draft under drafts/. This tool never sends email.',
  input: emailInput,
  relativePath: (args) => `drafts/${safeFileName(undefined, args.subject, '.eml')}`,
  content: emailContent
})

const calendarInput = z.object({
  root: z.string().optional().describe('Approved folder for the calendar draft; defaults to Workspace.'),
  title: z.string().trim().min(1).max(240),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  description: z.string().max(10_000).optional(),
  location: z.string().max(1000).optional()
})

type CalendarArgs = z.infer<typeof calendarInput>

export const createCalendarDraftTool = generatedFileTool<CalendarArgs>({
  name: 'create_calendar_event',
  description: 'Create an unsent .ics calendar event under calendar/. The user reviews and imports it.',
  input: calendarInput,
  relativePath: (args) => `calendar/${safeFileName(undefined, args.title, '.ics')}`,
  content: calendarContent
})

async function collectNoteFiles(
  root: string,
  maxDepth: number,
  maxFiles: number
): Promise<Array<{ absolute: string; relative: string }>> {
  const files: Array<{ absolute: string; relative: string }> = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth || files.length >= maxFiles) return
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    for (const entry of entries) {
      if (files.length >= maxFiles || entry.name.startsWith('.')) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolute, depth + 1)
      } else if (entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name)) {
        files.push({ absolute, relative: path.relative(root, absolute) })
      }
    }
  }

  await visit(root, 0)
  return files
}

function safeFileName(input: string | undefined, fallback: string, extension: string): string {
  const raw = input?.trim() || slug(fallback)
  const normalized = raw.replace(/\\/g, '/').replace(/^notes\//i, '')
  const segments = normalized.split('/')
  if (
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new ToolError('Use a filename inside the tool\'s draft folder.')
  }

  const safe = segments.map((segment) => segment.replace(/[<>:"|?*\x00-\x1f]/g, '-')).join('/')
  return safe.toLowerCase().endsWith(extension) ? safe : `${safe}${extension}`
}

function slug(value: string): string {
  const result = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72)
  return result || `draft-${randomUUID().slice(0, 8)}`
}

function emailContent(args: EmailArgs): string {
  const addresses = args.to.split(/[;,]/).map((value) => value.trim()).filter(Boolean)
  if (
    addresses.length === 0 ||
    addresses.some((address) => !/^[^\s<>@,;]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(address))
  ) {
    throw new ToolError('Use plain email addresses in the To field; display names are not supported.')
  }
  if (/[\r\n\x00-\x1f]/.test(args.subject)) throw new ToolError('The subject contains invalid header characters.')

  const subject = /^[\x20-\x7e]*$/.test(args.subject)
    ? args.subject
    : `=?UTF-8?B?${Buffer.from(args.subject, 'utf8').toString('base64')}?=`
  const body = args.body.replace(/\r?\n/g, '\r\n')
  return [
    `To: ${addresses.join(', ')}`,
    `Subject: ${subject}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
    ''
  ].join('\r\n')
}

function calendarContent(args: CalendarArgs): string {
  const start = Date.parse(args.startsAt)
  const end = Date.parse(args.endsAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new ToolError('The calendar event must end after it starts.')
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mike Assist//Calendar Draft//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${randomUUID()}@mike-assist.local`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(new Date(start))}`,
    `DTEND:${icsDate(new Date(end))}`,
    `SUMMARY:${escapeIcs(args.title)}`
  ]
  if (args.description) lines.push(`DESCRIPTION:${escapeIcs(args.description)}`)
  if (args.location) lines.push(`LOCATION:${escapeIcs(args.location)}`)
  lines.push('END:VEVENT', 'END:VCALENDAR', '')
  return lines.join('\r\n')
}

function icsDate(value: Date): string {
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

export const noteTools = [searchNotesTool, createNoteTool, createEmailDraftTool, createCalendarDraftTool]
