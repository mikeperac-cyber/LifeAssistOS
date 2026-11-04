import { z } from 'zod'
import type { ChatMode, ScheduledAgentTask, ScheduledTaskSchedule, ToolDef } from '../shared/types'
import type { ScheduledAgentTaskInput, ScheduledTaskStore } from '../core/scheduled-tasks'

const modeSchema = z.enum(['assistant', 'brainstorm', 'software', 'review', 'coach_personal', 'coach_business'])
const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.string().min(20).max(40) }),
  z.object({ kind: z.literal('daily'), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.object({ kind: z.literal('weekdays'), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.object({ kind: z.literal('weekly'), weekday: z.number().int().min(0).max(6), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })
])

function describeSchedule(schedule: ScheduledTaskSchedule): string {
  if (schedule.kind === 'once') return `once at ${schedule.at}`
  if (schedule.kind === 'daily') return `daily at ${schedule.time} local time`
  if (schedule.kind === 'weekdays') return `weekdays at ${schedule.time} local time`
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return `every ${weekdays[schedule.weekday]} at ${schedule.time} local time`
}

function safeTaskSummary(task: ScheduledAgentTask): Omit<ScheduledAgentTask, 'prompt' | 'lastSummary' | 'lastError'> & {
  promptPreview: string
  lastSummary: string | null
  lastError: string | null
} {
  const { prompt, ...rest } = task
  return { ...rest, promptPreview: prompt.slice(0, 400), lastSummary: task.lastSummary?.slice(0, 1200) ?? null, lastError: task.lastError }
}

export function createScheduledTaskTools(store: ScheduledTaskStore): ToolDef<any, any>[] {
  const schedule: ToolDef<ScheduledAgentTaskInput, unknown> = {
    name: 'schedule_agent_task',
    description: 'Create a recurring or one-time prompt for Mike Assist to run later on this device. Every scheduled run is isolated, receives read and external tools only, and still asks before external access. Use coach_personal or coach_business for recurring check-ins. Do not imply it will run while the app is closed.',
    risk: 'write',
    sessionApprovalAllowed: false,
    input: z.object({
      name: z.string().min(2).max(100),
      prompt: z.string().min(5).max(6000),
      mode: modeSchema,
      schedule: scheduleSchema
    }),
    scope: () => ({ kind: 'none' }),
    preview: (args) => `Create "${args.name}" (${describeSchedule(args.schedule)}; ${args.mode}). Instructions: ${args.prompt.slice(0, 700)}`,
    run: async (args) => {
      const task = await store.create(args)
      return safeTaskSummary(task)
    }
  }

  const list: ToolDef<Record<string, never>, unknown> = {
    name: 'list_scheduled_agent_tasks',
    description: 'List saved one-time and recurring Mike Assist prompt tasks, including their next run time and recent outcome.',
    risk: 'read',
    input: z.object({}),
    scope: () => ({ kind: 'none' }),
    run: async () => store.list().map(safeTaskSummary)
  }

  return [schedule, list]
}

export function isScheduledMode(value: unknown): value is ChatMode {
  return modeSchema.safeParse(value).success
}
