import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChatMode, ScheduledAgentRun, ScheduledAgentTask, ScheduledTaskSchedule } from '../shared/types'

interface ScheduledTaskFile {
  version: 1
  tasks: ScheduledAgentTask[]
  runs: ScheduledAgentRun[]
}

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
}

export type ScheduledTaskRunner = (task: ScheduledAgentTask, trigger: 'scheduled' | 'manual') => Promise<ScheduledRunOutput | null>

export class ScheduledTaskStore {
  private tasks: ScheduledAgentTask[] = []
  private runs: ScheduledAgentRun[] = []
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<ScheduledTaskFile>
      this.tasks = Array.isArray(parsed.tasks)
        ? parsed.tasks.filter(isScheduledTask).slice(0, 100).map(cloneTask)
        : []
      this.runs = Array.isArray(parsed.runs)
        ? parsed.runs.filter(isScheduledRun).slice(-100).map(cloneRun)
        : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[scheduled-tasks] could not read saved tasks; starting empty', error)
      }
      this.tasks = []
      this.runs = []
    }
    await this.persist()
  }

  list(): ScheduledAgentTask[] {
    return [...this.tasks]
      .sort((left, right) => (left.nextRunAt ?? left.createdAt).localeCompare(right.nextRunAt ?? right.createdAt))
      .map(cloneTask)
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
    this.tasks.push(task)
    await this.persist()
    return cloneTask(task)
  }

  async setEnabled(id: string, enabled: boolean, now = new Date()): Promise<ScheduledAgentTask> {
    const task = this.findMutable(id)
    if (enabled && task.schedule.kind === 'once' && Date.parse(task.schedule.at) <= now.getTime()) {
      throw new Error('That one-time task has passed. Run it manually or create a new schedule.')
    }
    task.enabled = enabled
    if (enabled) task.nextRunAt = nextScheduledOccurrence(task.schedule, now)
    task.updatedAt = now.toISOString()
    await this.persist()
    return cloneTask(task)
  }

  async remove(id: string): Promise<ScheduledAgentTask> {
    const index = this.tasks.findIndex((entry) => entry.id === id)
    if (index < 0) throw new Error('That scheduled task no longer exists.')
    const [removed] = this.tasks.splice(index, 1)
    await this.persist()
    return cloneTask(removed)
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
    this.runs.push(run)
    this.runs = this.runs.slice(-100)
    const task = this.tasks.find((entry) => entry.id === taskId)
    if (task) {
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
    }
    await this.persist()
    return cloneRun(run)
  }

  private findMutable(id: string): ScheduledAgentTask {
    const task = this.tasks.find((entry) => entry.id === id)
    if (!task) throw new Error('That scheduled task no longer exists.')
    return task
  }

  private persist(): Promise<void> {
    const payload: ScheduledTaskFile = {
      version: 1,
      tasks: this.tasks.map(cloneTask),
      runs: this.runs.map(cloneRun)
    }
    const operation = this.writeQueue.then(async () => {
      const temporary = `${this.file}.${randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      await rename(temporary, this.file)
    })
    this.writeQueue = operation.catch(() => undefined)
    return operation
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
    private readonly changed: (task: ScheduledAgentTask, result: ScheduledAgentRun) => void | Promise<void>,
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

  async runNow(id: string): Promise<{ ok: boolean; error?: string; task?: ScheduledAgentTask }> {
    const task = this.store.get(id)
    const result = await this.execute(task, 'manual')
    if (!result) return { ok: false, error: 'Another task is running. Try again when it finishes.' }
    return { ok: result.status === 'success', error: result.error, task: this.store.list().find((entry) => entry.id === id) }
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

    const run = await this.store.recordRun(task.id, trigger, output, startedAt, this.now())
    const current = this.store.list().find((entry) => entry.id === task.id)
    if (current) {
      try { await this.changed(current, run) }
      catch (error) { console.error('[scheduled-tasks] completion handler failed', error) }
    }
    return output
  }
}
