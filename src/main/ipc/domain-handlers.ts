import type { IpcMain } from 'electron'
import type { PlanningStore } from '../../core/planning'
import type { AssistEvent, PlanTaskPriority, PlanTaskStatus } from '../../shared/types'

export interface DomainIpcContext {
  ipcMain: Pick<IpcMain, 'handle'>
  getPlanning: () => PlanningStore | null
  sendEvent?: (event: AssistEvent) => void
  errorMessage: (error: unknown) => string
}

const priorities = new Set<PlanTaskPriority>(['low', 'normal', 'high'])
const statuses = new Set<PlanTaskStatus>(['open', 'done', 'cancelled'])

export function registerDomainIpcHandlers(ctx: DomainIpcContext): void {
  const { ipcMain } = ctx
  ipcMain.handle('assist:today', (_event, date: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning) return { date: '', tasks: [], inbox: [] }
    try { return planning.snapshot(typeof date === 'string' ? date : undefined) }
    catch { return planning.snapshot() }
  })
  ipcMain.handle('assist:plan-tasks', (_event, includeCompleted: unknown) =>
    ctx.getPlanning()?.listTasks(includeCompleted === true) ?? []
  )

  ipcMain.handle('assist:plan-task-add', async (_event, raw: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isRecord(raw) || typeof raw.title !== 'string') return failure('A task needs a title.')
    const value = raw as Record<string, unknown>
    if (!isOptionalText(value.notes) || !isOptionalNullableText(value.dueDate) ||
      !isOptionalNullableText(value.remindAt) || !isOptionalPriority(value.priority) ||
      !isOptionalNullableText(value.parentTaskId)) return failure('Choose valid task details.')
    try {
      const task = planning.addTask({
        title: value.title as string,
        notes: typeof value.notes === 'string' ? value.notes : undefined,
        dueDate: value.dueDate as string | null | undefined,
        remindAt: value.remindAt as string | null | undefined,
        priority: value.priority as PlanTaskPriority | undefined,
        parentTaskId: value.parentTaskId as string | null | undefined
      })
      tasksChanged(ctx)
      return { ok: true, task, snapshot: planning.snapshot() }
    } catch (error) { return failure(ctx.errorMessage(error)) }
  })

  ipcMain.handle('assist:plan-task-update', async (_event, raw: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isRecord(raw) || typeof raw.id !== 'string' || !isRecord(raw.patch)) {
      return failure('Invalid task update.')
    }
    const patch = raw.patch as Record<string, unknown>
    if (!isOptionalText(patch.title) || !isOptionalText(patch.notes) ||
      !isOptionalNullableText(patch.dueDate) || !isOptionalNullableText(patch.remindAt) ||
      !isOptionalPriority(patch.priority) || !isOptionalStatus(patch.status) ||
      !isOptionalNullableText(patch.parentTaskId)) return failure('Choose valid task details.')
    try {
      const task = planning.updateTask(raw.id, {
        title: patch.title as string | undefined,
        notes: patch.notes as string | undefined,
        dueDate: patch.dueDate as string | null | undefined,
        remindAt: patch.remindAt as string | null | undefined,
        priority: patch.priority as PlanTaskPriority | undefined,
        status: patch.status as PlanTaskStatus | undefined,
        parentTaskId: patch.parentTaskId as string | null | undefined
      })
      tasksChanged(ctx)
      return { ok: true, task, snapshot: planning.snapshot() }
    } catch (error) { return failure(ctx.errorMessage(error)) }
  })

  ipcMain.handle('assist:inbox-capture', (_event, text: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || typeof text !== 'string') return failure('Capture some text first.')
    try {
      planning.capture(text)
      tasksChanged(ctx)
      return { ok: true, snapshot: planning.snapshot() }
    } catch (error) { return failure(ctx.errorMessage(error)) }
  })

  ipcMain.handle('assist:inbox-convert', (_event, raw: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isRecord(raw) || typeof raw.id !== 'string') return failure('Invalid inbox item.')
    if (raw.input !== undefined && !isRecord(raw.input)) return failure('Invalid inbox task details.')
    const input = (raw.input ?? {}) as Record<string, unknown>
    if (!isOptionalText(input.title) || !isOptionalText(input.notes) ||
      !isOptionalNullableText(input.dueDate) || !isOptionalNullableText(input.remindAt) ||
      !isOptionalPriority(input.priority)) return failure('Invalid inbox task details.')
    try {
      const task = planning.convertInbox(raw.id, {
        title: input.title as string | undefined,
        notes: input.notes as string | undefined,
        dueDate: input.dueDate as string | null | undefined,
        remindAt: input.remindAt as string | null | undefined,
        priority: input.priority as PlanTaskPriority | undefined
      })
      tasksChanged(ctx)
      return { ok: true, task, snapshot: planning.snapshot() }
    } catch (error) { return failure(ctx.errorMessage(error)) }
  })

  ipcMain.handle('assist:inbox-dismiss', (_event, id: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || typeof id !== 'string') return failure('Invalid inbox item.')
    try {
      planning.dismissInbox(id)
      tasksChanged(ctx)
      return { ok: true, snapshot: planning.snapshot() }
    } catch (error) { return failure(ctx.errorMessage(error)) }
  })
}

function tasksChanged(ctx: DomainIpcContext): void { ctx.sendEvent?.({ type: 'today_changed' }) }
function failure(error: string): { ok: false; error: string } { return { ok: false, error } }
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function isOptionalText(value: unknown): boolean { return value === undefined || typeof value === 'string' }
function isOptionalNullableText(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string'
}
function isOptionalPriority(value: unknown): boolean {
  return value === undefined || priorities.has(value as PlanTaskPriority)
}
function isOptionalStatus(value: unknown): boolean {
  return value === undefined || statuses.has(value as PlanTaskStatus)
}
