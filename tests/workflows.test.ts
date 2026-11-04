import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WorkflowStore,
  extractWorkflowParameters,
  interpolateWorkflowSteps,
  buildWorkflowDraftFromTurn
} from '../src/core/workflows'
import type { WorkflowStep } from '../src/shared/types'

let dir = ''
let file = ''
let store: WorkflowStore

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-workflows-'))
  file = path.join(dir, 'workflows.json')
  store = new WorkflowStore(file)
  await store.init()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('WorkflowStore', () => {
  it('persists exact local tool arguments and loads them after restart', async () => {
    const steps: WorkflowStep[] = [
      { tool: 'list_dir', args: { root: 'Workspace', path: 'reports' }, summary: 'List Workspace/reports' },
      { tool: 'create_note', args: { root: 'Workspace', title: 'Daily', content: 'Daily report' }, summary: 'Create report note' }
    ]
    const saved = await store.save({ name: 'Daily report', prompt: 'List reports and make a note', steps })
    expect(saved.steps).toEqual(steps)

    const reloaded = new WorkflowStore(file)
    await reloaded.init()
    expect(reloaded.get(saved.id)).toEqual(saved)
  })

  it('rejects duplicate names, external tools, and too many steps', async () => {
    await store.save({
      name: 'Local task',
      prompt: 'Read notes',
      steps: [{ tool: 'read_file', args: { path: 'notes.md' }, summary: 'Read notes.md' }]
    })
    await expect(store.save({
      name: 'local TASK',
      prompt: 'Another prompt',
      steps: [{ tool: 'read_file', args: {}, summary: 'Read file' }]
    })).rejects.toThrow(/already exists/i)
    await expect(store.save({
      name: 'Website fetch',
      prompt: 'Fetch a website',
      steps: [{ tool: 'web_fetch', args: { url: 'https://example.com' }, summary: 'Fetch page' }]
    })).rejects.toThrow(/cannot be saved/i)
    await expect(store.save({
      name: 'Too many',
      prompt: 'Do things',
      steps: Array.from({ length: 17 }, () => ({ tool: 'list_dir', args: {}, summary: 'List' }))
    })).rejects.toThrow(/1–16 steps/)
  })

  it('removes a workflow without affecting other templates', async () => {
    const one = await store.save({
      name: 'One', prompt: 'one', steps: [{ tool: 'list_dir', args: {}, summary: 'List' }]
    })
    const two = await store.save({
      name: 'Two', prompt: 'two', steps: [{ tool: 'list_dir', args: {}, summary: 'List' }]
    })
    await store.remove(one.id)
    expect(store.list().map((workflow) => workflow.id)).toEqual([two.id])
  })

  it('extracts {{parameter}} placeholders and interpolates runtime values including default {{date}}', () => {
    const steps: WorkflowStep[] = [
      {
        tool: 'read_file',
        args: { path: 'templates/{{template}}.md' },
        summary: 'Read {{template}}'
      },
      {
        tool: 'write_file',
        args: {
          path: 'reports/{{date}}-{{topic}}.md',
          content: 'Report on {{topic}} for {{client}}'
        },
        summary: 'Write report on {{topic}}'
      }
    ]

    expect(extractWorkflowParameters(steps)).toEqual(['template', 'date', 'topic', 'client'])

    const interpolated = interpolateWorkflowSteps(
      steps,
      { template: 'weekly', topic: 'Q4-budget', client: 'Acme' },
      new Date('2026-11-03T12:00:00Z')
    )

    expect(interpolated).toEqual([
      {
        tool: 'read_file',
        args: { path: 'templates/weekly.md' },
        summary: 'Read weekly'
      },
      {
        tool: 'write_file',
        args: {
          path: 'reports/2026-11-03-Q4-budget.md',
          content: 'Report on Q4-budget for Acme'
        },
        summary: 'Write report on Q4-budget'
      }
    ])
  })

  it('ignores meta discovery tools (find_tools, load_skill) and supports multi-domain local tools when building a workflow draft', async () => {
    const draft = buildWorkflowDraftFromTurn('Summarize and log task', [
      {
        name: 'find_tools',
        args: { query: 'planning' },
        summary: 'Find planning tools',
        ok: true
      },
      {
        name: 'load_skill',
        args: { id: 'skill-1' },
        summary: 'Load skill',
        ok: true
      },
      {
        name: 'read_file',
        args: { path: 'notes.md' },
        summary: 'Read notes.md',
        ok: true
      },
      {
        name: 'create_task',
        args: { title: 'Follow up on notes' },
        summary: 'Create task',
        ok: true
      }
    ])

    expect(draft).not.toBeNull()
    expect(draft?.steps.map((s) => s.tool)).toEqual(['read_file', 'create_task'])

    const saved = await store.save({
      name: 'Notes to task',
      prompt: draft!.prompt,
      steps: draft!.steps
    })
    expect(saved.steps).toHaveLength(2)
  })
})
