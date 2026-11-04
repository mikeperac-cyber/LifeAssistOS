import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChatMode, ScheduledAgentRun, ScheduledAgentTask, ScheduledTaskSchedule } from '../shared/types'

interface ScheduledTaskFile {
  version: 1
  tasks: ScheduledAgentTask[]
  runs: ScheduledAgentRun[]
}

const RUN_HISTORY_SAVE_WARNING = 'The run finished, but its history could not be saved. It may run again after Mike Assist restarts.'

export interface ScheduledAgentTaskInput {
  name: string
  prompt: string
  mode: ChatMode
  schedule: ScheduledTaskSchedule
}

export interface ScheduledRunOutput {
  status: 'success' | 'failed'
  summary: string
  error?: string
  persistenceWarning?: string
}

export type ScheduledTaskRunner = (task: ScheduledAgentTask, trigger: 'scheduled' | 'manual') => Promise<ScheduledRunOutput | null>

export class ScheduledTaskStore {
  private tasks: ScheduledAgentTask[] = []
  private runs: ScheduledAgentRun[] = []
  private mutationQueue: Promise<void> = Promise.resolve()
  private readonly runPersistenceWarnings = new Map<string, string>()

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    await this.mutate(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      let nextTasks: ScheduledAgentTask[] = []
      let nextRuns: ScheduledAgentRun[] = []
      try {
        const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<ScheduledTaskFile>
        nextTasks = Array.isArray(parsed.tasks)
          ? parsed.tasks.filter(isScheduledTask).slice(0, 100).map(cloneTask)
          : []
        nextRuns = Array.isArray(parsed.runs)
          ? parsed.runs.filter(isScheduledRun).slice(-100).map(cloneRun)
          : []
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('[scheduled-tasks] could not read saved tasks; starting empty', error)
        }
      }
      await this.persist(nextTasks, nextRuns)
      this.tasks = nextTasks
      this.runs = nextRuns
    })
  }

  list(): ScheduledAgentTask[] {
    return [...this.tasks]
      .sort((left, right) => (left.nextRunAt ?? left.createdAt).localeCompare(right.nextRunAt ?? right.createdAt))
      .map((task) => {
        const copy = cloneTask(task)
        const warning = this.runPersistenceWarnings.get(task.id)
        if (warning) copy.lastError = copy.lastError ? `${copy.lastError} ${warning}` : warning
        return copy
      })
  }

  get(id: string): ScheduledAgentTask {
    const task = this.tasks.find((entry) => entry.id === id)
    if (!task) throw new Error('That scheduled task no longer exists.')
    return cloneTask(task)
  }

  listRuns(taskId?: string): ScheduledAgentRun[] {
    return this.runs.filter((run) => !taskId || run.taskId === taskId).map(cloneRun)
  }

  async create(input: ScheduledAgentTaskInput, now = new Date()): Promise<ScheduledAgentTask> {
    return this.mutate(async () => {
      if (this.tasks.length >= 100) throw new Error('The scheduled task list is full. Remove an old task first.')
      const name = input.name.replace(/\s+/g, ' ').trim()
      const prompt = input.prompt.trim()
      if (name.length < 2 || name.length > 100) throw new Error('Task names must be 2–100 characters.')
      if (prompt.length < 5 || prompt.length > 6000) throw new Error('Task instructions must be 5–6,000 characters.')
      validateMode(input.mode)
      validateSchedule(input.schedule)
      const schedule = cloneSchedule(input.schedule)
      const nextRunAt = nextScheduledOccurrence(schedule, now)
      if (!nextRunAt) throw new Error('Choose a future time for a one-time scheduled task.')
      if (this.tasks.some((entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        throw new Error('A scheduled task with that name already exists.')
      }

      const createdAt = now.toISOString()
      const task: ScheduledAgentTask = {
        id: randomUUID(),
        name,
        prompt,
        mode: input.mode,
        schedule,
        enabled: true,
        nextRunAt,
        lastRunAt: null,
        lastOutcome: null,
        lastSummary: null,
        lastError: null,
        runCount: 0,
        createdAt,
        updatedAt: createdAt
      }
      const nextTasks = [...this.tasks, task]
      await this.persist(nextTasks, this.runs)
      this.tasks = nextTasks
      return cloneTask(task)
    })
  }

  async setEnabled(id: string, enabled: boolean, now = new Date()): Promise<ScheduledAgentTask> {
    return this.mutate(async () => {
      const index = this.tasks.findIndex((entry) => entry.id === id)
      if (index < 0) throw new Error('That scheduled task no longer exists.')
      const task = cloneTask(this.tasks[index])
      if (enabled && task.schedule.kind === 'once' && Date.parse(task.schedule.at) <= now.getTime()) {
        throw new Error('That one-time task has passed. Run it manually or create a new schedule.')
      }
      task.enabled = enabled
      if (enabled) task.nextRunAt = nextScheduledOccurrence(task.schedule, now)
      task.updatedAt = now.toISOString()
      const nextTasks = [...this.tasks]
      nextTasks[index] = task
      await this.persist(nextTasks, this.runs)
      this.tasks = nextTasks
      return cloneTask(task)
    })
  }

  async remove(id: string): Promise<ScheduledAgentTask> {
    return this.mutate(async () => {
      const index = this.tasks.findIndex((entry) => entry.id === id)
      if (index < 0) throw new Error('That scheduled task no longer exists.')
      const removed = this.tasks[index]
      const nextTasks = this.tasks.filter((entry) => entry.id !== id)
      await this.persist(nextTasks, this.runs)
      this.tasks = nextTasks
      return cloneTask(removed)
    })
  }

  due(through = new Date()): ScheduledAgentTask[] {
    const timestamp = through.getTime()
    return this.tasks
      .filter((task) => task.enabled && task.nextRunAt && Date.parse(task.nextRunAt) <= timestamp)
      .sort((left, right) => (left.nextRunAt ?? '').localeCompare(right.nextRunAt ?? ''))
      .map(cloneTask)
  }

  async recordRun(
    taskId: string,
    trigger: 'scheduled' | 'manual',
    output: ScheduledRunOutput,
    startedAt: Date,
    finishedAt = new Date()
  ): Promise<ScheduledAgentRun> {
    return this.mutate(async () => {
      const run: ScheduledAgentRun = {
        id: randomUUID(),
        taskId,
        trigger,
        status: output.status,
        summary: output.summary.trim().slice(0, 6000),
        error: output.error?.trim().slice(0, 1000) || null,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString()
      }
      const nextRuns = [...this.runs, run].slice(-100)
      const nextTasks = this.tasks.map((entry) => {
        if (entry.id !== taskId) return entry
        const task = cloneTask(entry)
        task.lastRunAt = run.finishedAt
        task.lastOutcome = run.status
        task.lastSummary = run.summary
        task.lastError = run.error
        task.runCount += 1
        task.updatedAt = run.finishedAt
        if (task.schedule.kind === 'once') {
          task.enabled = false
          task.nextRunAt = null
        } else if (task.enabled) {
          task.nextRunAt = nextScheduledOccurrence(task.schedule, finishedAt)
        }
        return task
      })

      // The agent action has already run. Keep its result in memory even if the
      // history write fails, so this session does not immediately repeat it.
      this.tasks = nextTasks
      this.runs = nextRuns
      try {
        await this.persist(nextTasks, nextRuns)
      } catch (error) {
        this.runPersistenceWarnings.set(taskId, RUN_HISTORY_SAVE_WARNING)
        throw error
      }
      return cloneRun(run)
    })
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async persist(tasks: ScheduledAgentTask[], runs: ScheduledAgentRun[]): Promise<void> {
    const payload: ScheduledTaskFile = {
      version: 1,
      tasks: tasks.map(cloneTask),
      runs: runs.map(cloneRun)
    }
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      await rename(temporary, this.file)
      this.runPersistenceWarnings.clear()
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }
}

/** Local time is resolved on this computer. Missed recurring occurrences run once after launch, then resume their normal cadence. */
export function nextScheduledOccurrence(schedule: ScheduledTaskSchedule, after: Date): string | null {
  if (schedule.kind === 'once') {
    const timestamp = Date.parse(schedule.at)
    return Number.isFinite(timestamp) && timestamp > after.getTime() ? new Date(timestamp).toISOString() : null
  }

  const [hour, minute] = schedule.time.split(':').map(Number)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null

  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const candidate = new Date(after)
    candidate.setDate(candidate.getDate() + dayOffset)
    candidate.setHours(hour, minute, 0, 0)
    if (candidate.getTime() <= after.getTime()) continue
    const weekday = candidate.getDay()
    const matches = schedule.kind === 'daily' ||
      (schedule.kind === 'weekdays' && weekday >= 1 && weekday <= 5) ||
      (schedule.kind === 'weekly' && weekday === schedule.weekday)
    if (matches) return candidate.toISOString()
  }
  return null
}

function validateSchedule(schedule: ScheduledTaskSchedule): void {
  if (schedule.kind === 'once') {
    if (typeof schedule.at !== 'string' || !Number.isFinite(Date.parse(schedule.at)) || !/(Z|[+-]\d{2}:\d{2})$/i.test(schedule.at)) {
      throw new Error('Use a valid one-time date and time with a UTC offset.')
    }
    return
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) throw new Error('Use a local 24-hour time such as 08:30.')
  if (schedule.kind === 'weekly' && (!Number.isInteger(schedule.weekday) || schedule.weekday < 0 || schedule.weekday > 6)) {
    throw new Error('Choose a valid weekday from 0 (Sunday) to 6 (Saturday).')
  }
}

function validateMode(mode: ChatMode): void {
  if (!['assistant', 'brainstorm', 'software', 'review', 'coach_personal', 'coach_business'].includes(mode)) {
    throw new Error('Choose a supported assistant mode.')
  }
}

function isScheduledTask(value: unknown): value is ScheduledAgentTask {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<ScheduledAgentTask>
  try {
    if (
      typeof task.id !== 'string' || typeof task.name !== 'string' || task.name.length < 2 || task.name.length > 100 ||
      typeof task.prompt !== 'string' || task.prompt.length < 5 || task.prompt.length > 6000 ||
      typeof task.mode !== 'string' || !['assistant', 'brainstorm', 'software', 'review', 'coach_personal', 'coach_business'].includes(task.mode) ||
      typeof task.enabled !== 'boolean' || (task.nextRunAt !== null && typeof task.nextRunAt !== 'string') ||
      (task.lastRunAt !== null && typeof task.lastRunAt !== 'string') ||
      (task.lastOutcome !== null && task.lastOutcome !== 'success' && task.lastOutcome !== 'failed') ||
      (task.lastSummary !== null && typeof task.lastSummary !== 'string') ||
      (task.lastError !== null && typeof task.lastError !== 'string') ||
      typeof task.runCount !== 'number' || !Number.isInteger(task.runCount) || task.runCount < 0 ||
      typeof task.createdAt !== 'string' || typeof task.updatedAt !== 'string'
    ) return false
    validateSchedule(task.schedule as ScheduledTaskSchedule)
    return true
  } catch {
    return false
  }
}

function isScheduledRun(value: unknown): value is ScheduledAgentRun {
  if (!value || typeof value !== 'object') return false
  const run = value as Partial<ScheduledAgentRun>
  return typeof run.id === 'string' && typeof run.taskId === 'string' &&
    (run.trigger === 'scheduled' || run.trigger === 'manual') &&
    (run.status === 'success' || run.status === 'failed') && typeof run.summary === 'string' && run.summary.length <= 6000 &&
    (run.error === null || typeof run.error === 'string') && typeof run.startedAt === 'string' && typeof run.finishedAt === 'string'
}

function cloneTask(task: ScheduledAgentTask): ScheduledAgentTask {
  return { ...task, schedule: cloneSchedule(task.schedule) }
}

function cloneSchedule(schedule: ScheduledTaskSchedule): ScheduledTaskSchedule {
  return { ...schedule }
}

function cloneRun(run: ScheduledAgentRun): ScheduledAgentRun {
  return { ...run }
}

/** Runs at most one scheduled agent task at a time. A null runner result means defer without consuming the occurrence. */
export class ScheduledTaskScheduler {
  private timer: ReturnType<typeof setInterval> | undefined
  private checking = false
  private readonly running = new Set<string>()

  constructor(
    private readonly store: ScheduledTaskStore,
    private readonly run: ScheduledTaskRunner,
    private readonly changed: (task: ScheduledAgentTask, result: ScheduledAgentRun, warning?: string) => void | Promise<void>,
    private readonly intervalMs = 15_000,
    private readonly now: () => Date = () => new Date()
  ) {}

  start(): void {
    if (this.timer) return
    void this.checkDue()
    this.timer = setInterval(() => { void this.checkDue() }, Math.max(500, this.intervalMs))
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  async runNow(id: string): Promise<{ ok: boolean; error?: string; warning?: string; task?: ScheduledAgentTask }> {
    const task = this.store.get(id)
    const result = await this.execute(task, 'manual')
    if (!result) return { ok: false, error: 'Another task is running. Try again when it finishes.' }
    return {
      ok: result.status === 'success',
      error: result.error,
      warning: result.persistenceWarning,
      task: this.store.list().find((entry) => entry.id === id)
    }
  }

  isRunning(id: string): boolean { return this.running.has(id) }

  async checkDue(): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      const task = this.store.due(this.now()).find((entry) => !this.running.has(entry.id))
      if (task) await this.execute(task, 'scheduled')
    } catch (error) {
      console.error('[scheduled-tasks] due check failed', error)
    } finally {
      this.checking = false
    }
  }

  private async execute(task: ScheduledAgentTask, trigger: 'scheduled' | 'manual'): Promise<ScheduledRunOutput | null> {
    if (this.running.has(task.id)) return null
    this.running.add(task.id)
    const startedAt = this.now()
    let output: ScheduledRunOutput | null = null
    try {
      output = await this.run(task, trigger)
    } catch (error) {
      output = {
        status: 'failed',
        summary: 'The scheduled task did not finish.',
        error: error instanceof Error ? error.message : String(error)
      }
    } finally {
      this.running.delete(task.id)
    }
    if (!output) return null

    const finishedAt = this.now()
    let run: ScheduledAgentRun
    try {
      run = await this.store.recordRun(task.id, trigger, output, startedAt, finishedAt)
    } catch (error) {
      // recordRun retains the completed action in memory before writing. Recover
      // that record so the UI reports the real result and does not suggest a retry.
      const persistedInMemory = this.store.listRuns(task.id).find((entry) =>
        entry.startedAt === startedAt.toISOString() && entry.finishedAt === finishedAt.toISOString()
      )
      if (!persistedInMemory) throw error
      run = persistedInMemory
      console.error('[scheduled-tasks] run finished but its history could not be saved', error)
      output = { ...output, persistenceWarning: RUN_HISTORY_SAVE_WARNING }
    }
    const current = this.store.list().find((entry) => entry.id === task.id)
    if (current) {
      try { await this.changed(current, run, output.persistenceWarning) }
      catch (error) { console.error('[scheduled-tasks] completion handler failed', error) }
    }
    return output
  }
}
