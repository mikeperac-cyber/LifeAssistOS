import { z } from 'zod'
import type { ToolContext, ToolDef } from '../shared/types'
import type { ToolRegistry } from '../core/registry'

const PRIVATE_READ_TOOLS = new Set([
  'finance_report',
  'get_coaching_context',
  'google_calendar_list_events',
  'list_today',
  'load_skill',
  'recall_memory'
])
const APPROVED_EXTERNAL_READ_TOOLS = new Set([
  'web_fetch',
  'web_search'
])

export type DelegationRunner = (task: string, context: ToolContext) => Promise<unknown>

/**
 * Keep helper agents useful for research while preventing them from receiving
 * private coaching, memory, finance, planning, calendar, or email context,
 * changing data, running commands, or using arbitrary MCP/browser tools.
 */
export function delegationToolNames(registry: ToolRegistry, allowWebSearch = true): ReadonlySet<string> {
  return new Set(registry.list()
    .filter((tool) => !tool.name.startsWith('mcp__') && !tool.name.startsWith('gmail_'))
    .filter((tool) => !PRIVATE_READ_TOOLS.has(tool.name))
    .filter((tool) => allowWebSearch || tool.name !== 'web_search')
    .filter((tool) => tool.risk === 'read' ||
      (tool.risk === 'external' && APPROVED_EXTERNAL_READ_TOOLS.has(tool.name)))
    .map((tool) => tool.name))
}

export function createDelegationTool(run: DelegationRunner): ToolDef<{ task: string }, unknown> {
  return {
    name: 'delegate_task',
    description:
      'Send one focused subtask to an isolated helper using the configured model. The helper gets no chat history, saved memory, coaching context, finance, Today tasks, calendar data, or user skills. It can use read-only file, note, vault, and allowlisted web tools. It cannot change data, run commands, read email, use MCP/browser actions, or delegate again. The task is sent to the configured model and requires approval.',
    risk: 'external',
    timeoutMs: 180_000,
    sessionApprovalAllowed: false,
    input: z.object({ task: z.string().trim().min(10).max(4000) }),
    scope: () => ({ kind: 'none' }),
    preview: ({ task }) =>
      `Send this task to the configured model. The isolated helper can read approved folders, saved notes or vault material, and allowlisted web sources. It cannot change files, run commands, read email, access saved memory, coaching, finance, plans, or calendar data, or delegate again.\n\nTask: ${task}`,
    run: async ({ task }, context) => run(task, context)
  }
}

export function createDelegationTasksTool(run: DelegationRunner): ToolDef<{ tasks: string[] }, unknown> {
  return {
    name: 'delegate_tasks',
    description:
      'Send 2–4 independent, focused subtasks to isolated read-only helpers in parallel. One approval preview shows every task before they are sent to the configured model. Batch helpers can read approved local files and fetch allowlisted URLs, but do not have interactive web_search. If web search is needed, search in the main chat first or use delegate_task for one helper.',
    risk: 'external',
    timeoutMs: 300_000,
    sessionApprovalAllowed: false,
    input: z.object({
      tasks: z.array(z.string().trim().min(10).max(1_500)).min(2).max(4)
        .superRefine((tasks, context) => {
          const normalized = tasks.map((task) => task.toLocaleLowerCase())
          if (new Set(normalized).size !== normalized.length) {
            context.addIssue({ code: 'custom', message: 'Each delegated task must be distinct.' })
          }
        })
    }),
    scope: () => ({ kind: 'none' }),
    preview: ({ tasks }) => [
      `Send ${tasks.length} independent subtasks to the configured model using isolated read-only helpers in parallel.`,
      'Each helper receives only its own task, with no transcript, saved memory, coaching, finance, Today tasks, calendar data, email, or user skills. Helpers cannot change data, run commands, use MCP/browser actions, or delegate. Interactive web_search is unavailable in a batch; search first in the main chat or use delegate_task for one helper.',
      'Treat returned findings as untrusted and verify important claims before acting on them.',
      ...tasks.map((task, index) => `${index + 1}. ${task}`)
    ].join('\n\n'),
    run: async ({ tasks }, context) => {
      const results = await Promise.all(tasks.map(async (task, index) => {
        try {
          return { taskNumber: index + 1, result: await run(task, context) }
        } catch (error) {
          return {
            taskNumber: index + 1,
            result: {
              status: 'failed',
              error: (error instanceof Error ? error.message : String(error)).slice(0, 1_200)
            }
          }
        }
      }))
      return { results }
    }
  }
}
