import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WorkflowRecord, WorkflowStep } from '../shared/types'
import {
  REPLAYABLE_WORKFLOW_TOOLS,
  META_DISCOVERY_TOOLS,
  extractWorkflowParameters,
  interpolateWorkflowSteps,
  buildWorkflowDraftFromTurn
} from '../shared/workflow-params'

export {
  REPLAYABLE_WORKFLOW_TOOLS,
  META_DISCOVERY_TOOLS,
  extractWorkflowParameters,
  interpolateWorkflowSteps,
  buildWorkflowDraftFromTurn
}

interface WorkflowFile {
  version: 1
  workflows: WorkflowRecord[]
}

export class WorkflowStore {
  private workflows: WorkflowRecord[] = []

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<WorkflowFile>
      this.workflows = Array.isArray(parsed.workflows)
        ? parsed.workflows
            .filter(isWorkflowRecord)
            .filter((workflow) => workflow.steps.length <= 16 && workflow.steps.every((step) =>
              (REPLAYABLE_WORKFLOW_TOOLS as readonly string[]).includes(step.tool)
            ))
            .map(cloneWorkflow)
        : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[workflows] could not read workflow templates; starting empty', error)
      }
      this.workflows = []
    }
    await this.persist()
  }

  list(): WorkflowRecord[] {
    return [...this.workflows]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(cloneWorkflow)
  }

  get(id: string): WorkflowRecord {
    const workflow = this.workflows.find((entry) => entry.id === id)
    if (!workflow) throw new Error('That workflow no longer exists.')
    return cloneWorkflow(workflow)
  }

  async save(input: { name: string; prompt: string; steps: WorkflowStep[] }): Promise<WorkflowRecord> {
    const name = input.name.replace(/\s+/g, ' ').trim()
    const prompt = input.prompt.trim()
    if (name.length < 2 || name.length > 80) throw new Error('Workflow names must be 2–80 characters.')
    if (!prompt || prompt.length > 4000) throw new Error('The workflow prompt is empty or too long.')
    if (input.steps.length === 0 || input.steps.length > 16) throw new Error('A workflow must contain 1–16 steps.')
    if (this.workflows.length >= 100) throw new Error('The workflow library is full. Remove an old workflow first.')

    const allowed = new Set<string>(REPLAYABLE_WORKFLOW_TOOLS)
    const steps = input.steps.map((step) => {
      if (!allowed.has(step.tool)) throw new Error(`The ${step.tool} tool cannot be saved in a workflow.`)
      const serialized = JSON.stringify(step.args)
      if (serialized.length > 250_000) throw new Error('A workflow step is too large to save.')
      return {
        tool: step.tool,
        args: JSON.parse(serialized) as unknown,
        summary: step.summary.slice(0, 240)
      }
    })

    if (this.workflows.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('A workflow with that name already exists.')
    }

    const workflow: WorkflowRecord = {
      id: randomUUID(),
      name,
      prompt,
      steps,
      createdAt: new Date().toISOString()
    }
    this.workflows.push(workflow)
    await this.persist()
    return cloneWorkflow(workflow)
  }

  async remove(id: string): Promise<WorkflowRecord> {
    const index = this.workflows.findIndex((workflow) => workflow.id === id)
    if (index < 0) throw new Error('That workflow no longer exists.')
    const [removed] = this.workflows.splice(index, 1)
    await this.persist()
    return cloneWorkflow(removed)
  }

  private async persist(): Promise<void> {
    const payload: WorkflowFile = { version: 1, workflows: this.workflows }
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(temporary, this.file)
  }
}

function isWorkflowRecord(value: unknown): value is WorkflowRecord {
  if (!value || typeof value !== 'object') return false
  const workflow = value as Partial<WorkflowRecord>
  const valid = (
    typeof workflow.id === 'string' &&
    typeof workflow.name === 'string' &&
    typeof workflow.prompt === 'string' &&
    typeof workflow.createdAt === 'string' &&
    Array.isArray(workflow.steps) &&
    workflow.steps.length > 0 &&
    workflow.steps.length <= 16 &&
    workflow.name.length <= 80 &&
    workflow.prompt.length <= 4000 &&
    workflow.steps.every((step) =>
      Boolean(
        step &&
        typeof step.tool === 'string' &&
        'args' in step &&
        typeof step.summary === 'string' &&
        step.summary.length <= 240 &&
        JSON.stringify(step.args).length <= 250_000
      )
    )
  )
  return valid
}

function cloneWorkflow(workflow: WorkflowRecord): WorkflowRecord {
  return JSON.parse(JSON.stringify(workflow)) as WorkflowRecord
}
