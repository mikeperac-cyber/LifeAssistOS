import type { IpcMain } from 'electron'
import type { PlanningStore } from '../../core/planning'
import type { AreaColorName, AreaIconName, AssistEvent, PlanTaskPriority, PlanTaskStatus, TaskRecurrenceInput, TaskWorkflowStage } from '../../shared/types'
import { isDateOnly } from '../../shared/date-only'

export interface DomainIpcContext {
  ipcMain: Pick<IpcMain, 'handle'>
  getPlanning: () => PlanningStore | null
  sendEvent?: (event: AssistEvent) => void
  errorMessage: (error: unknown) => string
}

const priorities = new Set<PlanTaskPriority>(['low', 'normal', 'high'])
const statuses = new Set<PlanTaskStatus>(['open', 'done', 'cancelled'])
const workflowStages = new Set<TaskWorkflowStage>(['next', 'in-progress', 'waiting'])
const areaIcons = new Set<AreaIconName>(['briefcase', 'home', 'book', 'leaf'])
const areaColors = new Set<AreaColorName>(['teal', 'blue', 'amber', 'violet'])

export function registerDomainIpcHandlers(ctx: DomainIpcContext): void {
  const { ipcMain } = ctx
  ipcMain.handle('assist:today', (_event, date: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning) return { date: '', tasks: [], inbox: [] }
    try { return planning.snapshot(typeof date === 'string' && isDateOnly(date) ? date : undefined) }
    catch { return planning.snapshot() }
  })
  ipcMain.handle('assist:plan-tasks', (_event, includeCompleted: unknown) =>
    ctx.getPlanning()?.listTasks(includeCompleted === true) ?? []
  )
  ipcMain.handle('assist:my-day', (_event, date: unknown) => {
    if (typeof date !== 'string' || !isDateOnly(date)) return []
    try { return ctx.getPlanning()?.listMyDay(date) ?? [] } catch { return [] }
  })
  ipcMain.handle('assist:plan-task-day', (_event, raw: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isRecord(raw) || !isValidId(raw.id) || (raw.date !== null && (typeof raw.date !== 'string' || !isDateOnly(raw.date)))) return failure('Choose a valid task and date.')
    try {
      const task = planning.planTaskForDay(raw.id, raw.date as string | null)
      tasksChanged(ctx)
      return { ok: true, task, snapshot: planning.snapshot() }
    } catch (error) { return failure(ctx.errorMessage(error)) }
  })
  ipcMain.handle('assist:my-day-reorder', (_event, raw: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isRecord(raw) || typeof raw.date !== 'string' || !isDateOnly(raw.date) || !Array.isArray(raw.ids) || raw.ids.length > 500 || raw.ids.some((id) => !isValidId(id))) return failure('Choose a valid My Day order.')
    try {
      planning.reorderMyDay(raw.date, raw.ids as string[])
      tasksChanged(ctx)
      return { ok: true, snapshot: planning.snapshot() }
    } catch (error) { return failure(ctx.errorMessage(error)) }
  })
  ipcMain.handle('assist:my-day-apply-suggestion', (_event, raw: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isRecord(raw) || typeof raw.date !== 'string' || !isDateOnly(raw.date) || !Array.isArray(raw.ids) || raw.ids.length > 30 || raw.ids.some((id) => !isValidId(id))) return failure('Choose a valid suggested plan.')
    try {
      planning.applySuggestedMyDayOrder(raw.date, raw.ids as string[])
      tasksChanged(ctx)
      return { ok: true, snapshot: planning.snapshot() }
    } catch (error) { return failure(ctx.errorMessage(error)) }
  })
  ipcMain.handle('assist:projects-workspace', () => ctx.getPlanning()?.projectWorkspace() ?? { areas: [], projects: [], tasks: [] })
  ipcMain.handle('assist:area-create', (_event, raw: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isRecord(raw) || !isTextWithin(raw.name, 80) || typeof raw.icon !== 'string' || !areaIcons.has(raw.icon as AreaIconName) || typeof raw.color !== 'string' || !areaColors.has(raw.color as AreaColorName)) return failure('Choose a valid Area name, icon, and color.')
    try { const area = planning.createArea({ name: raw.name, icon: raw.icon as AreaIconName, color: raw.color as AreaColorName }); tasksChanged(ctx); return { ok: true, area } }
    catch (error) { return failure(ctx.errorMessage(error)) }
  })
  ipcMain.handle('assist:area-delete', (_event, id: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isValidId(id)) return failure('Choose a valid Area.')
    try { planning.deleteArea(id); tasksChanged(ctx); return { ok: true } }
    catch (error) { return failure(ctx.errorMessage(error)) }
  })
  ipcMain.handle('assist:project-create', (_event, raw: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isRecord(raw) || !isTextWithin(raw.name, 80) || !isOptionalTextWithin(raw.description, 1_500) || !isOptionalDate(raw.targetDate) || !isOptionalNullableId(raw.areaId) || !isOptionalNullableId(raw.goalId)) return failure('Choose valid project details.')
    try { const project = planning.createProject({ name: raw.name, description: raw.description as string | undefined, targetDate: raw.targetDate as string | null | undefined, areaId: raw.areaId as string | null | undefined, goalId: raw.goalId as string | null | undefined }); tasksChanged(ctx); return { ok: true, project } }
    catch (error) { return failure(ctx.errorMessage(error)) }
  })
  ipcMain.handle('assist:project-update', (_event, raw: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isRecord(raw) || !isValidId(raw.id) || !isRecord(raw.patch)) return failure('Choose a valid project update.')
    const patch = raw.patch
    if (!isOptionalTextWithin(patch.name, 80) || !isOptionalTextWithin(patch.description, 1_500) || !isOptionalDate(patch.targetDate) || !isOptionalNullableId(patch.areaId) || !isOptionalNullableId(patch.goalId)) return failure('Choose valid project details.')
    try { const project = planning.updateProject(raw.id, { name: patch.name as string | undefined, description: patch.description as string | undefined, targetDate: patch.targetDate as string | null | undefined, areaId: patch.areaId as string | null | undefined, goalId: patch.goalId as string | null | undefined }); tasksChanged(ctx); return { ok: true, project } }
    catch (error) { return failure(ctx.errorMessage(error)) }
  })
  ipcMain.handle('assist:project-delete', (_event, id: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isValidId(id)) return failure('Choose a valid project.')
    try { planning.deleteProject(id); tasksChanged(ctx); return { ok: true } }
    catch (error) { return failure(ctx.errorMessage(error)) }
  })

  ipcMain.handle('assist:plan-task-add', async (_event, raw: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isRecord(raw) || !isTextWithin(raw.title, 240)) return failure('A task needs a title of 240 characters or fewer.')
    const value = raw as Record<string, unknown>
    if (!isOptionalTextWithin(value.notes, 2_000) || !isOptionalDate(value.dueDate) || !isOptionalLocalDateTime(value.scheduledStart) || !isOptionalDuration(value.durationMinutes) ||
      !isOptionalReminder(value.remindAt) || !isOptionalPriority(value.priority) ||
      !isOptionalNullableId(value.parentTaskId) || !isOptionalNullableId(value.projectId) || !isOptionalWorkflowStage(value.workflowStage) ||
      !isOptionalRecurrenceRule(value.recurrenceRule)) return failure('Choose valid task details.')
    try {
      const task = planning.addTask({
        title: value.title as string,
        notes: typeof value.notes === 'string' ? value.notes : undefined,
        dueDate: value.dueDate as string | null | undefined,
        scheduledStart: value.scheduledStart as string | null | undefined,
        durationMinutes: value.durationMinutes as number | null | undefined,
        remindAt: value.remindAt as string | null | undefined,
        priority: value.priority as PlanTaskPriority | undefined,
        parentTaskId: value.parentTaskId as string | null | undefined,
        projectId: value.projectId as string | null | undefined,
        workflowStage: value.workflowStage as TaskWorkflowStage | undefined,
        recurrenceRule: value.recurrenceRule as TaskRecurrenceInput | null | undefined
      })
      tasksChanged(ctx)
      return { ok: true, task, snapshot: planning.snapshot() }
    } catch (error) { return failure(ctx.errorMessage(error)) }
  })

  ipcMain.handle('assist:plan-task-update', async (_event, raw: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isRecord(raw) || !isValidId(raw.id) || !isRecord(raw.patch)) {
      return failure('Invalid task update.')
    }
    const patch = raw.patch as Record<string, unknown>
    if (!isOptionalTextWithin(patch.title, 240) || !isOptionalTextWithin(patch.notes, 2_000) ||
      !isOptionalDate(patch.dueDate) || !isOptionalLocalDateTime(patch.scheduledStart) || !isOptionalDuration(patch.durationMinutes) || !isOptionalReminder(patch.remindAt) ||
      !isOptionalPriority(patch.priority) || !isOptionalStatus(patch.status) ||
      !isOptionalNullableId(patch.parentTaskId) || !isOptionalNullableId(patch.projectId) || !isOptionalWorkflowStage(patch.workflowStage) ||
      !isOptionalRecurrenceRule(patch.recurrenceRule)) return failure('Choose valid task details.')
    try {
      const task = planning.updateTask(raw.id, {
        title: patch.title as string | undefined,
        notes: patch.notes as string | undefined,
        dueDate: patch.dueDate as string | null | undefined,
        scheduledStart: patch.scheduledStart as string | null | undefined,
        durationMinutes: patch.durationMinutes as number | null | undefined,
        remindAt: patch.remindAt as string | null | undefined,
        priority: patch.priority as PlanTaskPriority | undefined,
        status: patch.status as PlanTaskStatus | undefined,
        parentTaskId: patch.parentTaskId as string | null | undefined,
        projectId: patch.projectId as string | null | undefined,
        workflowStage: patch.workflowStage as TaskWorkflowStage | undefined,
        recurrenceRule: patch.recurrenceRule as TaskRecurrenceInput | null | undefined
      })
      tasksChanged(ctx)
      return { ok: true, task, snapshot: planning.snapshot() }
    } catch (error) { return failure(ctx.errorMessage(error)) }
  })

  ipcMain.handle('assist:plan-task-skip-occurrence', (_event, id: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isValidId(id)) return failure('Choose a valid task.')
    try {
      const task = planning.skipTaskOccurrence(id)
      tasksChanged(ctx)
      return { ok: true, task, snapshot: planning.snapshot() }
    } catch (error) { return failure(ctx.errorMessage(error)) }
  })

  ipcMain.handle('assist:inbox-capture', (_event, text: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || typeof text !== 'string' || text.length > 2_000) return failure('Capture text must be 2,000 characters or fewer.')
    try {
      planning.capture(text)
      tasksChanged(ctx)
      return { ok: true, snapshot: planning.snapshot() }
    } catch (error) { return failure(ctx.errorMessage(error)) }
  })

  ipcMain.handle('assist:inbox-convert', (_event, raw: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isRecord(raw) || !isValidId(raw.id)) return failure('Invalid inbox item.')
    if (raw.input !== undefined && !isRecord(raw.input)) return failure('Invalid inbox task details.')
    const input = (raw.input ?? {}) as Record<string, unknown>
    if (!isOptionalTextWithin(input.title, 240) || !isOptionalTextWithin(input.notes, 2_000) ||
      !isOptionalDate(input.dueDate) || !isOptionalLocalDateTime(input.scheduledStart) || !isOptionalDuration(input.durationMinutes) || !isOptionalReminder(input.remindAt) ||
      !isOptionalPriority(input.priority) || !isOptionalNullableId(input.projectId) || !isOptionalWorkflowStage(input.workflowStage) ||
      !isOptionalRecurrenceRule(input.recurrenceRule)) return failure('Invalid inbox task details.')
    try {
      const task = planning.convertInbox(raw.id, {
        title: input.title as string | undefined,
        notes: input.notes as string | undefined,
        dueDate: input.dueDate as string | null | undefined,
        scheduledStart: input.scheduledStart as string | null | undefined,
        durationMinutes: input.durationMinutes as number | null | undefined,
        remindAt: input.remindAt as string | null | undefined,
        priority: input.priority as PlanTaskPriority | undefined,
        projectId: input.projectId as string | null | undefined,
        workflowStage: input.workflowStage as TaskWorkflowStage | undefined,
        recurrenceRule: input.recurrenceRule as TaskRecurrenceInput | null | undefined
      })
      tasksChanged(ctx)
      return { ok: true, task, snapshot: planning.snapshot() }
    } catch (error) { return failure(ctx.errorMessage(error)) }
  })

  ipcMain.handle('assist:inbox-dismiss', (_event, id: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !isValidId(id)) return failure('Invalid inbox item.')
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
function isTextWithin(value: unknown, maximum: number): value is string { return typeof value === 'string' && value.length <= maximum }
function isOptionalTextWithin(value: unknown, maximum: number): boolean { return value === undefined || isTextWithin(value, maximum) }
function isOptionalDate(value: unknown): boolean { return value === undefined || value === null || (typeof value === 'string' && value.length === 10 && isDateOnly(value)) }
function isOptionalLocalDateTime(value: unknown): boolean { return value === undefined || value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && isDateOnly(value.slice(0, 10))) }
function isOptionalDuration(value: unknown): boolean { return value === undefined || value === null || (Number.isInteger(value) && (value as number) >= 5 && (value as number) <= 720) }
function isOptionalReminder(value: unknown): boolean { return value === undefined || value === null || (typeof value === 'string' && value.length <= 40) }
function isOptionalNullableId(value: unknown): boolean { return value === undefined || value === null || isValidId(value) }
function isOptionalPriority(value: unknown): boolean {
  return value === undefined || priorities.has(value as PlanTaskPriority)
}
function isOptionalStatus(value: unknown): boolean {
  return value === undefined || statuses.has(value as PlanTaskStatus)
}
function isOptionalWorkflowStage(value: unknown): boolean { return value === undefined || workflowStages.has(value as TaskWorkflowStage) }
function isOptionalRecurrenceRule(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (!isRecord(value) || Object.keys(value).some((key) => !['frequency', 'weekdays', 'endsOn'].includes(key))) return false
  if (value.frequency !== 'daily' && value.frequency !== 'weekly' && value.frequency !== 'monthly') return false
  if (value.endsOn !== undefined && value.endsOn !== null && (typeof value.endsOn !== 'string' || !isDateOnly(value.endsOn))) return false
  if (value.frequency === 'weekly') {
    return Array.isArray(value.weekdays) && value.weekdays.length > 0 && value.weekdays.length <= 7 &&
      value.weekdays.every((day) => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6)
  }
  return value.weekdays === undefined
}
function isValidId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 80 }
