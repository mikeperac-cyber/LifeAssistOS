import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ToolRegistry } from '../src/core/registry'
import type { ToolDef } from '../src/shared/types'
import { createDelegationTasksTool, createDelegationTool, delegationToolNames } from '../src/tools/delegation'

function tool(name: string, risk: ToolDef['risk']): ToolDef<Record<string, never>, unknown> {
  return {
    name,
    description: name,
    risk,
    input: z.object({}),
    scope: () => ({ kind: 'none' }),
    run: async () => ({})
  }
}

describe('delegation tools', () => {
  it('gives helpers read-only tools but excludes private context and sensitive integrations', () => {
    const registry = new ToolRegistry()
    registry.register(tool('list_dir', 'read'))
    registry.register(tool('recall_memory', 'read'))
    registry.register(tool('get_coaching_context', 'read'))
    registry.register(tool('load_skill', 'read'))
    registry.register(tool('finance_report', 'read'))
    registry.register(tool('list_today', 'read'))
    registry.register(tool('search_notes', 'read'))
    registry.register(tool('search_vault', 'read'))
    registry.register(tool('gmail_read_message', 'external'))
    registry.register(tool('google_calendar_list_events', 'external'))
    registry.register(tool('web_search', 'external'))
    registry.register(tool('web_fetch', 'external'))
    registry.register(tool('delegate_tasks', 'external'))
    registry.register(tool('mcp__personal__anything', 'read'))
    registry.register(tool('write_file', 'write'))
    registry.register(tool('run_command', 'command'))

    expect([...delegationToolNames(registry)].sort()).toEqual([
      'list_dir',
      'search_notes',
      'search_vault',
      'web_fetch',
      'web_search'
    ])
    expect([...delegationToolNames(registry, false)]).not.toContain('web_search')
    expect([...delegationToolNames(registry, false)]).toContain('web_fetch')
  })

  it('requires a bounded nonempty task and clearly previews model data sharing', async () => {
    let received = ''
    const delegate = createDelegationTool(async (task) => {
      received = task
      return { response: 'Done' }
    })

    expect(delegate.risk).toBe('external')
    expect(delegate.sessionApprovalAllowed).toBe(false)
    expect(delegate.input.safeParse({ task: 'short' }).success).toBe(false)
    expect(delegate.input.safeParse({ task: 'Review these source files.' }).success).toBe(true)
    const preview = await delegate.preview?.({ task: 'Review these source files.' }, { kind: 'none', signal: new AbortController().signal })
    expect(preview).toContain('configured model')
    expect(preview).toContain('cannot change files')
    expect(preview).toContain('calendar data')
    expect(preview).toContain('finance')
    expect(await delegate.run({ task: 'Review these source files.' }, { kind: 'none', signal: new AbortController().signal })).toEqual({ response: 'Done' })
    expect(received).toBe('Review these source files.')
  })

  it('runs two to four distinct delegated subtasks concurrently after one explicit approval', async () => {
    let active = 0
    let maximumActive = 0
    const delegated = createDelegationTasksTool(async (task) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, task.includes('authentication') ? 16 : 5))
      active -= 1
      return { status: 'completed', response: `Finding for ${task}` }
    })
    const tasks = [
      'Inspect the authentication design.',
      'Review the data storage approach.',
      'Check the deployment risks.'
    ]
    const context = { kind: 'none' as const, signal: new AbortController().signal }

    expect(delegated.risk).toBe('external')
    expect(delegated.sessionApprovalAllowed).toBe(false)
    expect(delegated.input.safeParse({ tasks: [tasks[0]] }).success).toBe(false)
    expect(delegated.input.safeParse({ tasks: [...tasks, 'Review the UI for usability.', 'Check accessibility support.'] }).success).toBe(false)
    expect(delegated.input.safeParse({ tasks: [tasks[0], ` ${tasks[0]} `] }).success).toBe(false)
    expect(delegated.input.safeParse({ tasks }).success).toBe(true)

    const preview = await delegated.preview?.({ tasks }, context)
    expect(preview).toContain('Inspect the authentication design.')
    expect(preview).toContain('Review the data storage approach.')
    expect(preview).toContain('cannot change data')
    expect(preview).toContain('coaching')

    const result = await delegated.run({ tasks }, context) as { results: Array<{ taskNumber: number; result: { response: string } }> }
    expect(maximumActive).toBe(3)
    expect(result.results.map((entry) => entry.taskNumber)).toEqual([1, 2, 3])
    expect(result.results.map((entry) => entry.result.response)).toEqual(tasks.map((task) => `Finding for ${task}`))
  })

  it('keeps partial findings when one parallel helper fails', async () => {
    const delegated = createDelegationTasksTool(async (task) => {
      if (task.includes('storage')) throw new Error('The helper could not read that source.')
      return { status: 'completed', response: `Finding for ${task}` }
    })
    const result = await delegated.run({ tasks: [
      'Inspect the authentication design.',
      'Review the data storage approach.'
    ] }, { kind: 'none', signal: new AbortController().signal }) as {
      results: Array<{ taskNumber: number; result: { status: string; response?: string; error?: string } }>
    }

    expect(result.results[0]).toMatchObject({ taskNumber: 1, result: { status: 'completed' } })
    expect(result.results[1]).toMatchObject({ taskNumber: 2, result: { status: 'failed', error: 'The helper could not read that source.' } })
  })
})
