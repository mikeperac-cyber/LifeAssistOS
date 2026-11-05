import { randomUUID } from 'node:crypto'
import type { IpcMain } from 'electron'
import type { AuditLog } from '../../core/audit/log'
import type { CoachingStore } from '../../core/coaching'
import type { Gateway } from '../../core/gateway/gateway'
import type { PlanningStore } from '../../core/planning'
import type { ResearchStore } from '../../core/research'
import type { ScheduledTaskScheduler, ScheduledTaskStore } from '../../core/scheduled-tasks'
import type { SkillStore } from '../../core/skills'
import type { VaultStore } from '../../core/vault'
import type { WorkflowStore } from '../../core/workflows'
import type {
  AssistantSkillInput,
  ChatMode,
  PlanTaskPriority,
  PlanTaskStatus,
  ScheduledTaskSchedule,
  ToolCall,
  VaultSourceType,
  WorkflowStep
} from '../../shared/types'

export interface DomainIpcContext {
  ipcMain: IpcMain
  getGateway: () => Gateway | null
  getResearch: () => ResearchStore | null
  getVault: () => VaultStore | null
  getPlanning: () => PlanningStore | null
  getCoaching: () => CoachingStore | null
  getWorkflows: () => WorkflowStore | null
  getScheduledTasks: () => ScheduledTaskStore | null
  getScheduledTaskScheduler: () => ScheduledTaskScheduler | null
  getSkills: () => SkillStore | null
  appendAuditAfterMutation: (event: Parameters<AuditLog['append']>[0]) => Promise<boolean>
  hasRunningAssistantTask: () => boolean
  setDirectToolBusy: (busy: boolean) => void
  errorMessage: (error: unknown) => string
}

function emptyCoachingContext() {
  return {
    profile: {
      style: 'supportive' as const,
      reflectionRetention: 'ephemeral' as const,
      boundaries: '',
      updatedAt: new Date(0).toISOString()
    },
    goals: [],
    journal: []
  }
}

export function registerDomainIpcHandlers(ctx: DomainIpcContext): void {
  const { ipcMain, errorMessage } = ctx

  ipcMain.handle('assist:research-projects', (_event, includeArchived: unknown) => {
    return ctx.getResearch()?.list(includeArchived === true) ?? []
  })

  ipcMain.handle('assist:research-project-create', async (_event, input: unknown) => {
    const research = ctx.getResearch()
    if (!research) return { ok: false, error: 'Research storage is not ready.' }
    if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid research project.' }
    const value = input as { title?: unknown; question?: unknown }
    if (typeof value.title !== 'string' || typeof value.question !== 'string') {
      return { ok: false, error: 'A research project needs a title and question.' }
    }
    try {
      const project = research.create({ title: value.title, question: value.question })
      await ctx.appendAuditAfterMutation({ type: 'research.project_created', data: {} })
      return { ok: true, project, projects: research.list() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:research-project-archive', async (_event, id: unknown) => {
    const research = ctx.getResearch()
    if (!research || typeof id !== 'string') return { ok: false, error: 'Invalid research project.' }
    try {
      const project = research.archive(id)
      await ctx.appendAuditAfterMutation({ type: 'research.project_archived', data: {} })
      return { ok: true, project, projects: research.list() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:research-project-remove', async (_event, id: unknown) => {
    const research = ctx.getResearch()
    if (!research || typeof id !== 'string') return { ok: false, error: 'Invalid research project.' }
    try {
      research.remove(id)
      await ctx.appendAuditAfterMutation({ type: 'research.project_removed', data: {} })
      return { ok: true, projects: research.list() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:research-source-add', async (_event, input: unknown) => {
    const research = ctx.getResearch()
    const gateway = ctx.getGateway()
    if (!research || !gateway) return { ok: false, error: 'Research services are not ready.' }
    if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid research source.' }
    const value = input as { projectId?: unknown; url?: unknown }
    if (typeof value.projectId !== 'string' || typeof value.url !== 'string') {
      return { ok: false, error: 'Choose a project and enter a URL.' }
    }
    let parsed: URL
    try {
      parsed = new URL(value.url.trim())
    } catch {
      return { ok: false, error: 'Enter a valid HTTPS URL.' }
    }
    if (parsed.protocol !== 'https:') return { ok: false, error: 'Research sources must use HTTPS.' }
    if (ctx.hasRunningAssistantTask()) return { ok: false, error: 'Wait for the active task to finish.' }

    const call: ToolCall = {
      id: randomUUID(),
      name: 'web_fetch',
      args: { url: parsed.toString() },
      summary: 'Fetch a research source',
      risk: 'external'
    }
    ctx.setDirectToolBusy(true)
    try {
      const result = await gateway.execute(call)
      if (!result.ok) return { ok: false, error: result.error ?? 'The source could not be fetched.' }
      const output = result.output as { url?: unknown; title?: unknown; text?: unknown } | undefined
      if (!output || typeof output.text !== 'string') {
        return { ok: false, error: 'The page did not return readable text.' }
      }
      const source = research.addSource({
        projectId: value.projectId,
        url: typeof output.url === 'string' ? output.url : parsed.toString(),
        title: typeof output.title === 'string' ? output.title : undefined,
        content: output.text
      })
      await ctx.appendAuditAfterMutation({ type: 'research.source_added', data: { chars: source.contentChars } })
      return { ok: true, source, projects: research.list() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    } finally {
      ctx.setDirectToolBusy(false)
    }
  })

  ipcMain.handle('assist:research-source-remove', async (_event, id: unknown) => {
    const research = ctx.getResearch()
    if (!research || typeof id !== 'string') return { ok: false, error: 'Invalid research source.' }
    try {
      research.removeSource(id)
      await ctx.appendAuditAfterMutation({ type: 'research.source_removed', data: {} })
      return { ok: true, projects: research.list() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:vault-search', (_event, query: unknown) => {
    const vault = ctx.getVault()
    if (!vault) return []
    return vault.search(typeof query === 'string' ? query : '')
  })

  ipcMain.handle('assist:vault-search-summaries', (_event, input: unknown) => {
    const vault = ctx.getVault()
    if (!vault) return []
    if (!input || typeof input !== 'object') return []
    const value = input as { query?: unknown; limit?: unknown }
    return vault.searchSummaries(
      typeof value.query === 'string' ? value.query : '',
      typeof value.limit === 'number' && Number.isFinite(value.limit) ? value.limit : 8
    )
  })

  ipcMain.handle('assist:vault-get', (_event, id: unknown) => {
    const vault = ctx.getVault()
    if (!vault || typeof id !== 'string') return { ok: false, error: 'Invalid vault document.' }
    try {
      return { ok: true, document: vault.get(id) }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:vault-create', async (_event, input: unknown) => {
    const vault = ctx.getVault()
    if (!vault) return { ok: false, error: 'Vault storage is not ready.' }
    if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid vault document.' }
    const value = input as { title?: unknown; body?: unknown; tags?: unknown; sourceType?: unknown; sourceRef?: unknown }
    if (typeof value.title !== 'string' || typeof value.body !== 'string') {
      return { ok: false, error: 'A document needs a title and content.' }
    }
    try {
      const document = vault.create({
        title: value.title,
        body: value.body,
        tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        sourceType: value.sourceType as VaultSourceType | undefined,
        sourceRef: typeof value.sourceRef === 'string' ? value.sourceRef : undefined
      })
      await ctx.appendAuditAfterMutation({ type: 'vault.document_created', data: { chars: document.body.length } })
      return { ok: true, document }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:vault-update', async (_event, payload: unknown) => {
    const vault = ctx.getVault()
    if (!vault || !payload || typeof payload !== 'object') return { ok: false, error: 'Invalid vault update.' }
    const value = payload as { id?: unknown; patch?: unknown }
    if (typeof value.id !== 'string' || !value.patch || typeof value.patch !== 'object') {
      return { ok: false, error: 'Invalid vault update.' }
    }
    try {
      const patch = value.patch as { title?: string; body?: string; tags?: string[] }
      const document = vault.update(value.id, patch)
      await ctx.appendAuditAfterMutation({ type: 'vault.document_updated', data: { chars: document.body.length } })
      return { ok: true, document }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:vault-delete', async (_event, id: unknown) => {
    const vault = ctx.getVault()
    if (!vault || typeof id !== 'string') return { ok: false, error: 'Invalid vault document.' }
    try {
      vault.delete(id)
      await ctx.appendAuditAfterMutation({ type: 'vault.document_deleted', data: {} })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:today', (_event, date: unknown) =>
    ctx.getPlanning()?.snapshot(typeof date === 'string' ? date : undefined) ?? { date: '', tasks: [], inbox: [] }
  )
  ipcMain.handle('assist:plan-tasks', (_event, includeCompleted: unknown) =>
    ctx.getPlanning()?.listTasks(includeCompleted === true) ?? []
  )

  ipcMain.handle('assist:plan-task-add', async (_event, input: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !input || typeof input !== 'object') return { ok: false, error: 'Invalid task.' }
    const value = input as { title?: unknown; notes?: unknown; dueDate?: unknown; remindAt?: unknown; priority?: unknown; sourceGoalId?: unknown }
    if (typeof value.title !== 'string') return { ok: false, error: 'A task needs a title.' }
    if (value.remindAt !== undefined && value.remindAt !== null && typeof value.remindAt !== 'string') {
      return { ok: false, error: 'Choose a valid reminder date and time.' }
    }
    try {
      const task = planning.addTask({
        title: value.title,
        notes: typeof value.notes === 'string' ? value.notes : undefined,
        dueDate: typeof value.dueDate === 'string' ? value.dueDate : null,
        remindAt: typeof value.remindAt === 'string' ? value.remindAt : null,
        priority: value.priority as PlanTaskPriority | undefined,
        sourceGoalId: typeof value.sourceGoalId === 'string' ? value.sourceGoalId : undefined
      })
      await ctx.appendAuditAfterMutation({ type: 'plan.task_created', data: {} })
      return { ok: true, task, snapshot: planning.snapshot() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:plan-task-update', async (_event, payload: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !payload || typeof payload !== 'object') return { ok: false, error: 'Invalid task update.' }
    const value = payload as { id?: unknown; patch?: unknown }
    if (typeof value.id !== 'string' || !value.patch || typeof value.patch !== 'object') {
      return { ok: false, error: 'Invalid task update.' }
    }
    try {
      const patch = value.patch as { title?: string; notes?: string; dueDate?: string | null; remindAt?: string | null; priority?: string; status?: string }
      if (patch.remindAt !== undefined && patch.remindAt !== null && typeof patch.remindAt !== 'string') {
        return { ok: false, error: 'Choose a valid reminder date and time.' }
      }
      const task = planning.updateTask(value.id, {
        ...patch,
        priority: patch.priority as PlanTaskPriority | undefined,
        status: patch.status as PlanTaskStatus | undefined
      })
      await ctx.appendAuditAfterMutation({ type: task.status === 'done' ? 'plan.task_completed' : 'plan.task_updated', data: {} })
      return { ok: true, task, snapshot: planning.snapshot() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:inbox-capture', async (_event, text: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || typeof text !== 'string') return { ok: false, error: 'Capture some text first.' }
    try {
      const item = planning.capture(text)
      await ctx.appendAuditAfterMutation({ type: 'plan.inbox_captured', data: { chars: item.text.length } })
      return { ok: true, inbox: planning.snapshot().inbox, snapshot: planning.snapshot() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:inbox-convert', async (_event, payload: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || !payload || typeof payload !== 'object') return { ok: false, error: 'Invalid inbox item.' }
    const value = payload as { id?: unknown; input?: { title?: string; dueDate?: string | null; priority?: string } }
    if (typeof value.id !== 'string') return { ok: false, error: 'Invalid inbox item.' }
    try {
      const task = planning.convertInbox(value.id, {
        ...value.input,
        priority: value.input?.priority as PlanTaskPriority | undefined
      })
      await ctx.appendAuditAfterMutation({ type: 'plan.inbox_converted', data: {} })
      return { ok: true, task, snapshot: planning.snapshot() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:inbox-dismiss', async (_event, id: unknown) => {
    const planning = ctx.getPlanning()
    if (!planning || typeof id !== 'string') return { ok: false, error: 'Invalid inbox item.' }
    try {
      planning.dismissInbox(id)
      await ctx.appendAuditAfterMutation({ type: 'plan.inbox_dismissed', data: {} })
      return { ok: true, snapshot: planning.snapshot() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:coaching-context', () => ctx.getCoaching()?.context() ?? emptyCoachingContext())
  ipcMain.handle('assist:coaching-journal', (_event, area: unknown) =>
    ctx.getCoaching()?.listJournal(area === 'personal' || area === 'lb_english' ? area : undefined) ?? []
  )

  ipcMain.handle('assist:coaching-profile-update', async (_event, input: unknown) => {
    const coaching = ctx.getCoaching()
    if (!coaching || !input || typeof input !== 'object') return { ok: false, error: 'Invalid coaching profile.' }
    const value = input as { style?: unknown; reflectionRetention?: unknown; boundaries?: unknown }
    try {
      const profile = coaching.updateProfile({
        style: value.style as 'supportive' | 'direct' | 'socratic' | undefined,
        reflectionRetention: value.reflectionRetention as 'ephemeral' | 'journal' | undefined,
        boundaries: typeof value.boundaries === 'string' ? value.boundaries : undefined
      })
      await ctx.appendAuditAfterMutation({
        type: 'coaching.profile_updated',
        data: { style: profile.style, retention: profile.reflectionRetention }
      })
      return { ok: true, context: coaching.context() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:coaching-goal-create', async (_event, input: unknown) => {
    const coaching = ctx.getCoaching()
    const gateway = ctx.getGateway()
    if (!coaching || !gateway) return { ok: false, error: 'Coaching services are not ready.' }
    if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid coaching goal.' }
    const value = input as { area?: unknown; title?: unknown; why?: unknown; targetDate?: unknown; milestones?: unknown }
    if ((value.area !== 'personal' && value.area !== 'lb_english') || typeof value.title !== 'string') {
      return { ok: false, error: 'Choose an area and enter a goal.' }
    }
    if (ctx.hasRunningAssistantTask()) return { ok: false, error: 'Wait for the active task to finish.' }
    const args = {
      area: value.area,
      title: value.title,
      why: typeof value.why === 'string' ? value.why : undefined,
      targetDate: typeof value.targetDate === 'string' && value.targetDate ? value.targetDate : undefined,
      milestones: Array.isArray(value.milestones)
        ? value.milestones.filter((item): item is string => typeof item === 'string')
        : undefined
    }
    const call: ToolCall = {
      id: randomUUID(),
      name: 'create_coaching_goal',
      args,
      summary: 'Create a coaching goal',
      risk: 'write'
    }
    ctx.setDirectToolBusy(true)
    try {
      const result = await gateway.execute(call)
      if (!result.ok) return result
      await ctx.appendAuditAfterMutation({ type: 'coaching.goal_created', data: { area: value.area } })
      return { ...result, context: coaching.context(), goal: result.output }
    } finally {
      ctx.setDirectToolBusy(false)
    }
  })

  ipcMain.handle('assist:coaching-goal-update', async (_event, payload: unknown) => {
    const coaching = ctx.getCoaching()
    if (!coaching || !payload || typeof payload !== 'object') return { ok: false, error: 'Invalid coaching goal update.' }
    const value = payload as { id?: unknown; patch?: unknown }
    if (typeof value.id !== 'string' || !value.patch || typeof value.patch !== 'object') {
      return { ok: false, error: 'Invalid coaching goal update.' }
    }
    try {
      const patch = value.patch as {
        title?: string
        why?: string
        targetDate?: string | null
        status?: string
        milestones?: Array<{ id: string; title: string; done: boolean }>
      }
      const goal = coaching.updateGoal(value.id, {
        ...patch,
        status: patch.status as 'active' | 'paused' | 'completed' | undefined
      })
      await ctx.appendAuditAfterMutation({
        type: goal.status === 'completed' ? 'coaching.goal_completed' : 'coaching.goal_updated',
        data: {}
      })
      return { ok: true, goal, context: coaching.context() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:coaching-journal-save', async (_event, input: unknown) => {
    const coaching = ctx.getCoaching()
    const gateway = ctx.getGateway()
    if (!coaching || !gateway) return { callId: randomUUID(), ok: false, blocked: true, error: 'Coaching services are not ready.' }
    if (!input || typeof input !== 'object') return { callId: randomUUID(), ok: false, blocked: true, error: 'Invalid coaching reflection.' }
    const value = input as { area?: unknown; kind?: unknown; body?: unknown }
    if (
      (value.area !== 'personal' && value.area !== 'lb_english') ||
      (value.kind !== 'daily' && value.kind !== 'weekly') ||
      typeof value.body !== 'string'
    ) {
      return { callId: randomUUID(), ok: false, blocked: true, error: 'Choose an area, review type, and reflection.' }
    }
    if (ctx.hasRunningAssistantTask()) return { callId: randomUUID(), ok: false, blocked: true, error: 'Wait for the active task to finish.' }
    const args = { area: value.area, kind: value.kind, body: value.body }
    const call: ToolCall = {
      id: randomUUID(),
      name: 'save_coaching_journal',
      args,
      summary: 'Save a private coaching reflection',
      risk: 'write'
    }
    ctx.setDirectToolBusy(true)
    try {
      const result = await gateway.execute(call)
      if (result.ok) {
        await ctx.appendAuditAfterMutation({
          type: 'coaching.journal_saved',
          data: { kind: value.kind, area: value.area }
        })
      }
      return result
    } finally {
      ctx.setDirectToolBusy(false)
    }
  })

  ipcMain.handle('assist:workflows', () => ctx.getWorkflows()?.list() ?? [])

  ipcMain.handle('assist:workflow-save', async (_event, input: unknown) => {
    const workflows = ctx.getWorkflows()
    if (!workflows) return { ok: false, error: 'Workflow storage is not ready.' }
    if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid workflow data.' }
    const { name, prompt, steps } = input as { name?: unknown; prompt?: unknown; steps?: unknown }
    if (typeof name !== 'string' || typeof prompt !== 'string' || !Array.isArray(steps)) {
      return { ok: false, error: 'A workflow needs a name, prompt, and recorded steps.' }
    }
    try {
      await workflows.save({ name, prompt, steps: steps as WorkflowStep[] })
      await ctx.appendAuditAfterMutation({ type: 'workflow.saved', data: { stepCount: steps.length } })
      return { ok: true, workflows: workflows.list() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:workflow-remove', async (_event, id: unknown) => {
    const workflows = ctx.getWorkflows()
    if (typeof id !== 'string' || !workflows) return { ok: false, error: 'Invalid workflow.' }
    try {
      await workflows.remove(id)
      await ctx.appendAuditAfterMutation({ type: 'workflow.removed', data: { workflowId: id } })
      return { ok: true, workflows: workflows.list() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:scheduled-tasks', () => ctx.getScheduledTasks()?.list() ?? [])
  ipcMain.handle('assist:scheduled-runs', (_event, taskId: unknown) =>
    ctx.getScheduledTasks()?.listRuns(typeof taskId === 'string' ? taskId : undefined) ?? []
  )

  ipcMain.handle('assist:scheduled-create', async (_event, payload: unknown) => {
    const scheduledTasks = ctx.getScheduledTasks()
    if (!scheduledTasks) return { ok: false, error: 'Scheduled task storage is not ready.' }
    if (ctx.hasRunningAssistantTask()) {
      return { ok: false, error: 'Wait for the active task to finish before creating a schedule.' }
    }
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'Invalid scheduled task.' }
    const value = payload as { name?: unknown; prompt?: unknown; mode?: unknown; schedule?: unknown }
    if (
      typeof value.name !== 'string' ||
      typeof value.prompt !== 'string' ||
      typeof value.mode !== 'string' ||
      !value.schedule ||
      typeof value.schedule !== 'object'
    ) {
      return { ok: false, error: 'A scheduled task needs a name, instructions, mode, and schedule.' }
    }
    try {
      const task = await scheduledTasks.create({
        name: value.name,
        prompt: value.prompt,
        mode: value.mode as ChatMode,
        schedule: value.schedule as ScheduledTaskSchedule
      })
      await ctx.appendAuditAfterMutation({
        type: 'scheduled_task.created',
        data: { taskId: task.id, mode: task.mode, schedule: task.schedule.kind }
      })
      return { ok: true, task, tasks: scheduledTasks.list() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:scheduled-enabled', async (_event, payload: unknown) => {
    const scheduledTasks = ctx.getScheduledTasks()
    if (!scheduledTasks) return { ok: false, error: 'Scheduled task storage is not ready.' }
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'Invalid scheduled task setting.' }
    const value = payload as { id?: unknown; enabled?: unknown }
    if (typeof value.id !== 'string' || typeof value.enabled !== 'boolean') {
      return { ok: false, error: 'Choose a task and enabled state.' }
    }
    try {
      const task = await scheduledTasks.setEnabled(value.id, value.enabled)
      await ctx.appendAuditAfterMutation({ type: 'scheduled_task.updated', data: { taskId: task.id, enabled: task.enabled } })
      return { ok: true, task, tasks: scheduledTasks.list() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:scheduled-remove', async (_event, id: unknown) => {
    const scheduledTasks = ctx.getScheduledTasks()
    const scheduler = ctx.getScheduledTaskScheduler()
    if (typeof id !== 'string' || !scheduledTasks) return { ok: false, error: 'Choose a scheduled task to remove.' }
    if (scheduler?.isRunning(id)) return { ok: false, error: 'Wait for this scheduled run to finish before removing it.' }
    try {
      const task = await scheduledTasks.remove(id)
      await ctx.appendAuditAfterMutation({ type: 'scheduled_task.removed', data: { taskId: task.id } })
      return { ok: true, task, tasks: scheduledTasks.list() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:scheduled-run', async (_event, id: unknown) => {
    const scheduler = ctx.getScheduledTaskScheduler()
    if (typeof id !== 'string' || !scheduler) return { ok: false, error: 'Scheduled tasks are not ready.' }
    try {
      return await scheduler.runNow(id)
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:skills', () => ctx.getSkills()?.list() ?? [])

  ipcMain.handle('assist:skill-save', async (_event, input: unknown) => {
    const skills = ctx.getSkills()
    if (!skills) return { ok: false, error: 'Skill storage is not ready.' }
    if (ctx.hasRunningAssistantTask()) return { ok: false, error: 'Wait for the active task to finish before editing skills.' }
    if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid skill data.' }
    const value = input as Partial<AssistantSkillInput>
    const validScope = ['general', 'personal', 'business', 'coding', 'education', 'research'].includes(String(value.scope))
    if (
      typeof value.name !== 'string' ||
      typeof value.description !== 'string' ||
      !validScope ||
      typeof value.instructions !== 'string' ||
      (value.id !== undefined && typeof value.id !== 'string') ||
      (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    ) {
      return { ok: false, error: 'A skill needs a name, description, category, and instructions.' }
    }
    try {
      const skill = await skills.save(value as AssistantSkillInput)
      await ctx.appendAuditAfterMutation({
        type: 'skill.changed',
        data: { operation: value.id ? 'updated' : 'created', skillId: skill.id }
      })
      return { ok: true, skills: skills.list() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:skill-enabled', async (_event, payload: unknown) => {
    const skills = ctx.getSkills()
    if (!skills) return { ok: false, error: 'Skill storage is not ready.' }
    if (ctx.hasRunningAssistantTask()) return { ok: false, error: 'Wait for the active task to finish before editing skills.' }
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'Invalid skill setting.' }
    const value = payload as { id?: unknown; enabled?: unknown }
    if (typeof value.id !== 'string' || typeof value.enabled !== 'boolean') {
      return { ok: false, error: 'Choose a skill and enabled state.' }
    }
    try {
      const skill = await skills.setEnabled(value.id, value.enabled)
      await ctx.appendAuditAfterMutation({
        type: 'skill.changed',
        data: { operation: value.enabled ? 'enabled' : 'disabled', skillId: skill.id }
      })
      return { ok: true, skills: skills.list() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('assist:skill-delete', async (_event, id: unknown) => {
    const skills = ctx.getSkills()
    if (!skills) return { ok: false, error: 'Skill storage is not ready.' }
    if (ctx.hasRunningAssistantTask()) return { ok: false, error: 'Wait for the active task to finish before editing skills.' }
    if (typeof id !== 'string') return { ok: false, error: 'Choose a skill to delete.' }
    try {
      const skill = await skills.remove(id)
      await ctx.appendAuditAfterMutation({ type: 'skill.changed', data: { operation: 'deleted', skillId: skill.id } })
      return { ok: true, skills: skills.list() }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })
}
