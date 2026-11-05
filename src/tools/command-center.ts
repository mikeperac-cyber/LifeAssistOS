import { z } from 'zod'
import type { EmailTaskProvider, ToolDef } from '../shared/types'
import type { PlanningStore } from '../core/planning'
import type { VaultStore } from '../core/vault'

export function createCommandCenterTools(vault: VaultStore, planning: PlanningStore): ToolDef<any, any>[] {
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
    run: async (args) => planning.capture(args.text)
  }

  const createTask: ToolDef<{ title: string; notes?: string; dueDate?: string; remindAt?: string; priority?: 'low' | 'normal' | 'high' }, unknown> = {
    name: 'create_task',
    description: 'Create a local Today task after approval. Set remindAt only when the user explicitly asks for a notification; it must be a future ISO-8601 date-time with a UTC offset. Notifications are delivered while Mike Assist is running; overdue reminders appear once on next launch.',
    risk: 'write',
    input: z.object({ title: z.string().min(1).max(240), notes: z.string().max(2000).optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), remindAt: z.string().datetime({ offset: true }).optional(), priority: z.enum(['low', 'normal', 'high']).optional() }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => `Create ${args.priority ?? 'normal'} task: ${args.title}${args.remindAt ? `\nWindows reminder: ${args.remindAt}` : ''}`,
    run: async (args) => planning.addTask(args)
  }

  const createEmailFollowupTask: ToolDef<{ provider: EmailTaskProvider; messageId: string; title: string; notes?: string; dueDate?: string; remindAt?: string; priority?: 'low' | 'normal' | 'high' }, unknown> = {
    name: 'create_email_followup_task',
    description: 'Create a local Today task based on a Gmail or Outlook email after approval. This tool does not access email. Use a message ID from an email the user has selected and approved for reading. Store only the provider and message ID as source provenance; include email content in task notes only when the user requests it, and show those notes in the approval preview. Set remindAt only when the user explicitly asks for a notification.',
    risk: 'write',
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
      'The task stores only the email provider and message ID as provenance.'
    ].filter(Boolean).join('\n'),
    run: async ({ provider, messageId, ...task }) => planning.addTask({ ...task, emailSource: { provider, messageId } })
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
    run: async ({ id, ...patch }) => planning.updateTask(id, patch)
  }

  const completeTask: ToolDef<{ id: string }, unknown> = {
    name: 'complete_task',
    description: 'Mark one local Today task complete after approval.',
    risk: 'write',
    input: z.object({ id: z.string().uuid() }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => `Complete local task ${args.id}.`,
    run: async (args) => planning.updateTask(args.id, { status: 'done' })
  }

  return [searchVault, listToday, saveVault, captureInbox, createTask, createEmailFollowupTask, updateTask, completeTask]
}
