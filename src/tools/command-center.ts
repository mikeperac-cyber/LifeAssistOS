import { z } from 'zod'
import type { CalendarTaskProvider, EmailTaskProvider, TaskExportProvider, ToolDef } from '../shared/types'
import type { PlanningStore } from '../core/planning'
import type { VaultStore } from '../core/vault'

const calendarEventTimeSchema = z.union([
  z.string().datetime({ offset: true }),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDateOnly, 'Use a real all-day event date.')
])

export function createCommandCenterTools(vault: VaultStore, planning: PlanningStore, onTodayChanged: () => void = () => undefined): ToolDef<any, any>[] {
  const searchVault: ToolDef<{ query: string }, unknown> = {
    name: 'search_vault',
    description: 'Search the local Knowledge Vault using full-text search.',
    risk: 'read',
    input: z.object({ query: z.string().min(1).max(400) }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => `Search local vault for: ${args.query}`,
    run: async (args) => vault.search(args.query)
  }

  const listToday: ToolDef<{ date?: string }, unknown> = {
    name: 'list_today',
    description: 'List open tasks due today or overdue, plus the uncategorized inbox.',
    risk: 'read',
    input: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    scope: () => ({ kind: 'none' }),
    preview: () => 'Read the local Today view.',
    run: async (args) => planning.snapshot(args.date)
  }

  const saveVault: ToolDef<{ title: string; body: string; tags?: string[] }, unknown> = {
    name: 'save_vault_document',
    description: 'Save durable knowledge to the local Knowledge Vault after approval.',
    risk: 'write',
    input: z.object({ title: z.string().min(1).max(240), body: z.string().min(1).max(200_000), tags: z.array(z.string().max(40)).max(20).optional() }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => `Save vault document “${args.title}” (${args.body.length} chars).`,
    run: async (args) => vault.create({ title: args.title, body: args.body, tags: args.tags, sourceType: 'manual' })
  }

  const captureInbox: ToolDef<{ text: string }, unknown> = {
    name: 'capture_inbox',
    description: 'Capture one thought or follow-up in the local Today inbox after approval.',
    risk: 'write',
    input: z.object({ text: z.string().min(1).max(2000) }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => `Capture to Today inbox: ${args.text.slice(0, 180)}`,
    run: async (args) => { const item = planning.capture(args.text); onTodayChanged(); return item }
  }

  const createTask: ToolDef<{ title: string; notes?: string; dueDate?: string; remindAt?: string; priority?: 'low' | 'normal' | 'high' }, unknown> = {
    name: 'create_task',
    description: 'Create a local Today task after approval. Set remindAt only when the user explicitly asks for a notification; it must be a future ISO-8601 date-time with a UTC offset. Notifications are delivered while Mike Assist is running; overdue reminders appear once on next launch.',
    risk: 'write',
    input: z.object({ title: z.string().min(1).max(240), notes: z.string().max(2000).optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), remindAt: z.string().datetime({ offset: true }).optional(), priority: z.enum(['low', 'normal', 'high']).optional() }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => `Create ${args.priority ?? 'normal'} task: ${args.title}${args.remindAt ? `\nWindows reminder: ${args.remindAt}` : ''}`,
    run: async (args) => { const task = planning.addTask(args); onTodayChanged(); return task }
  }

  const createEmailFollowupTask: ToolDef<{ provider: EmailTaskProvider; messageId: string; title: string; notes?: string; dueDate?: string; remindAt?: string; priority?: 'low' | 'normal' | 'high' }, unknown> = {
    name: 'create_email_followup_task',
    description: 'Create one local Today follow-up task for a selected Gmail or Outlook message from an approved search or read. This tool does not access email. Store only the provider and message ID as source provenance; include email content in task notes only when the user requests it, and show those notes in the approval preview. Repeated conversions return the existing task. Set remindAt only when the user explicitly asks for a notification.',
    risk: 'write',
    sessionApprovalAllowed: false,
    input: z.object({
      provider: z.enum(['gmail', 'outlook']),
      messageId: z.string().trim().min(1).max(512).refine((id) => !/[\u0000-\u001f\u007f]/.test(id), 'Email message IDs cannot contain control characters.'),
      title: z.string().trim().min(1).max(240),
      notes: z.string().trim().max(2000).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      remindAt: z.string().datetime({ offset: true }).optional(),
      priority: z.enum(['low', 'normal', 'high']).optional()
    }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => [
      `Create a local Today task from ${args.provider === 'gmail' ? 'Gmail' : 'Outlook'} email message ID ${args.messageId}.`,
      `Title: ${args.title}`,
      args.notes ? `Notes saved to this task:\n${args.notes}` : 'No email body or notes will be copied into the task.',
      args.dueDate ? `Due date: ${args.dueDate}` : undefined,
      args.remindAt ? `Reminder: ${args.remindAt}` : undefined,
      `Priority: ${args.priority ?? 'normal'}`,
      'The task stores only the email provider and message ID as provenance.',
      'If a task for this message already exists, it will be returned without changes.'
    ].filter(Boolean).join('\n'),
    run: async ({ provider, messageId, ...task }) => {
      const result = planning.addEmailFollowupTask({ ...task, emailSource: { provider, messageId } })
      if (result.created) onTodayChanged()
      return { status: result.created ? 'created' : 'already_exists', task: result.task }
    }
  }

  const createCalendarPrepTask: ToolDef<{
    provider: CalendarTaskProvider
    eventId: string
    eventTitle: string
    start: string
    end: string
    isAllDay?: boolean
    location?: string
    taskTitle?: string
    priority?: 'low' | 'normal' | 'high'
  }, unknown> = {
    name: 'create_calendar_prep_task',
    description: 'Create one local Today prep task from a selected event returned by an approved Google Calendar or Outlook Calendar read. Use the event ID, title, times, and location from that selected event; this tool does not access or change the calendar. The source event is stored locally and duplicate conversions return the existing task. Requires a separate approval for each selected event.',
    risk: 'write',
    sessionApprovalAllowed: false,
    input: z.object({
      provider: z.enum(['google_calendar', 'microsoft_calendar']),
      eventId: z.string().trim().min(1).max(1_024).refine((id) => !/[\u0000-\u001f\u007f]/.test(id), 'Calendar event IDs cannot contain control characters.'),
      eventTitle: z.string().trim().min(1).max(500),
      start: calendarEventTimeSchema,
      end: calendarEventTimeSchema,
      isAllDay: z.boolean().optional(),
      location: z.string().trim().max(300).optional(),
      taskTitle: z.string().trim().min(1).max(240).optional(),
      priority: z.enum(['low', 'normal', 'high']).optional()
    }).superRefine((args, context) => {
      if (Date.parse(args.end) <= Date.parse(args.start)) context.addIssue({ code: 'custom', message: 'The event must end after it starts.' })
      if (args.isAllDay === false && (!args.start.includes('T') || !args.end.includes('T'))) {
        context.addIssue({ code: 'custom', message: 'Timed events need date-time values.' })
      }
    }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => {
      const eventTitle = safeCalendarText(args.eventTitle)
      const title = safeCalendarText(args.taskTitle ?? `Prepare for: ${eventTitle}`).slice(0, 240)
      const allDay = args.isAllDay ?? !args.start.includes('T')
      const date = calendarEventDueDate(args.start, allDay)
      const provider = args.provider === 'google_calendar' ? 'Google Calendar' : 'Outlook Calendar'
      return [
        `Create a local prep task from ${provider}: “${eventTitle}”.`,
        `Task title: ${title}`,
        `Due date: ${date}`,
        allDay ? 'Event time: all day.' : `Event time: ${args.start} to ${args.end}`,
        args.location ? `Location saved locally: ${safeCalendarText(args.location)}` : undefined,
        `Priority: ${args.priority ?? 'normal'}.`,
        'The calendar is not changed. The local task stores the event ID to prevent duplicate conversions.'
      ].filter(Boolean).join('\n')
    },
    run: async (args) => {
      const eventTitle = safeCalendarText(args.eventTitle)
      const taskTitle = safeCalendarText(args.taskTitle ?? `Prepare for: ${eventTitle}`).slice(0, 240)
      const location = args.location ? safeCalendarText(args.location).slice(0, 300) : ''
      const notes = [
        `Calendar event: ${eventTitle}`,
        `Starts: ${args.start}`,
        `Ends: ${args.end}`,
        (args.isAllDay ?? !args.start.includes('T')) ? 'All-day event' : undefined,
        location ? `Location: ${location}` : undefined
      ].filter(Boolean).join('\n').slice(0, 2_000)
      const result = planning.addCalendarPrepTask({
        title: taskTitle,
        notes,
        dueDate: calendarEventDueDate(args.start, args.isAllDay ?? !args.start.includes('T')),
        priority: args.priority ?? 'normal',
        calendarSource: { provider: args.provider, eventId: args.eventId }
      })
      if (result.created) onTodayChanged()
      return {
        status: result.created ? 'created' : 'already_exists',
        taskId: result.task.id,
        title: result.task.title,
        dueDate: result.task.dueDate,
        provider: args.provider,
        eventId: args.eventId,
        note: result.created ? 'Created a local task; the calendar event was not changed.' : 'A task from this event already exists; no duplicate was created.'
      }
    }
  }

  const updateTask: ToolDef<{
    id: string
    title?: string
    notes?: string
    dueDate?: string | null
    remindAt?: string | null
    priority?: 'low' | 'normal' | 'high'
    status?: 'open' | 'done' | 'cancelled'
  }, unknown> = {
    name: 'update_task',
    description: 'Update a local Today task after approval. Set remindAt only when the user explicitly asks for a notification; use a future ISO-8601 date-time with a UTC offset, or null to clear it. Notifications are delivered while Mike Assist is running; overdue reminders appear once on next launch.',
    risk: 'write',
    input: z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(240).optional(),
      notes: z.string().max(2000).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      remindAt: z.string().datetime({ offset: true }).nullable().optional(),
      priority: z.enum(['low', 'normal', 'high']).optional(),
      status: z.enum(['open', 'done', 'cancelled']).optional()
    }).refine((args) => Object.keys(args).some((key) => key !== 'id'), { message: 'Choose at least one task field to update.' }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => `Update task ${args.id}: ${Object.keys(args).filter((key) => key !== 'id').join(', ')}.`,
    run: async ({ id, ...patch }) => { const updated = planning.updateTask(id, patch); onTodayChanged(); return updated }
  }

  const completeTask: ToolDef<{ id: string }, unknown> = {
    name: 'complete_task',
    description: 'Mark one local Today task complete after approval.',
    risk: 'write',
    input: z.object({ id: z.string().uuid() }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => `Complete local task ${args.id}.`,
    run: async (args) => { const task = planning.updateTask(args.id, { status: 'done' }); onTodayChanged(); return task }
  }

  const clearTaskExportRetryGuard: ToolDef<{ taskId: string; provider: TaskExportProvider; taskListId: string }, unknown> = {
    name: 'clear_task_export_retry_guard',
    description: 'Clear a local retry guard after the user has checked the selected Google Tasks or Microsoft To Do list and confirmed the remote create did not happen. This changes only the local guard; it does not delete or change any remote task. Requires separate local approval.',
    risk: 'write',
    sessionApprovalAllowed: false,
    input: z.object({ taskId: z.string().uuid(), provider: z.enum(['google_tasks', 'microsoft_todo']), taskListId: z.string().min(1).max(512) }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => {
      const task = planning.getTask(args.taskId)
      const prior = planning.getTaskExport(args.taskId, args.provider, args.taskListId)
      if (!prior || (prior.status !== 'sending' && prior.status !== 'uncertain')) throw new Error('This task has no uncertain send attempt for that destination.')
      const provider = args.provider === 'google_tasks' ? 'Google Tasks' : 'Microsoft To Do'
      const title = task.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
      const listId = args.taskListId.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
      return `Clear the local retry guard for “${title}” in ${provider} list ${listId}. First check that remote list; clearing the guard may allow a duplicate if the task was created.`
    },
    run: async (args) => {
      planning.clearTaskExportRetryGuard(args.taskId, args.provider, args.taskListId)
      onTodayChanged()
      return { cleared: true, provider: args.provider, taskListId: args.taskListId, note: 'No remote task was changed.' }
    }
  }

  return [searchVault, listToday, saveVault, captureInbox, createTask, createEmailFollowupTask, createCalendarPrepTask, updateTask, completeTask, clearTaskExportRetryGuard]
}

function safeCalendarText(value: string): string { return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() }

function calendarEventDueDate(start: string, isAllDay: boolean): string {
  if (isAllDay) return start.slice(0, 10)
  const date = new Date(start)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function isRealDateOnly(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
