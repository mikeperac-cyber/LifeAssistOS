import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '../src/core/registry'
import { createToolDiscoveryTool } from '../src/tools/tool-discovery'
import { optionalToolDomain } from '../src/core/agent/tool-discovery-catalog'
import type { ToolDef } from '../src/shared/types'
import { z } from 'zod'

function catalogTool(name: string, description: string): ToolDef<{}, unknown> {
  return {
    name,
    description,
    risk: 'read',
    input: z.object({}),
    scope: () => ({ kind: 'none' }),
    run: async () => ({})
  }
}

describe('tool discovery', () => {
  it('returns the best matching registered tools without exposing their schemas', async () => {
    const registry = new ToolRegistry()
      .register(catalogTool('mcp__gmail__search_messages', 'Search a connected Gmail account by sender, text, and date.'))
      .register(catalogTool('google_calendar_create_event', 'Create an event in Google Calendar after approval.'))
    const discovery = createToolDiscoveryTool(registry)

    const result = await discovery.run(
      { query: 'search Gmail messages', limit: 2 },
      { kind: 'none', signal: new AbortController().signal }
    ) as { tools: Array<{ name: string; description: string }> }

    expect(result.tools[0]?.name).toBe('mcp__gmail__search_messages')
    expect(result.tools[0]?.description).toContain('connected Gmail')
    expect(result.tools[0]).not.toHaveProperty('parameters')
  })

  it('matches Turkish capability queries with accents and common suffixes', async () => {
    const registry = new ToolRegistry()
      .register(catalogTool('finance_report', 'Show monthly finance totals.'))
      .register(catalogTool('gmail_search_messages', 'Search email messages by sender and date.'))
    const discovery = createToolDiscoveryTool(registry)

    const result = await discovery.run(
      { query: 'Bütçem ve harcamalarım', limit: 2 },
      { kind: 'none', signal: new AbortController().signal }
    ) as { tools: Array<{ name: string }> }

    expect(result.tools[0]?.name).toBe('finance_report')
  })

  it('finds the read-only Google Tasks tools for planning requests', async () => {
    const registry = new ToolRegistry()
      .register(catalogTool('google_tasks_list_task_lists', 'List task lists in connected Google Tasks.'))
      .register(catalogTool('google_tasks_list_tasks', 'List open tasks from one selected Google Tasks list.'))
    const discovery = createToolDiscoveryTool(registry)
    const result = await discovery.run(
      { query: 'show my Google Tasks', limit: 4 },
      { kind: 'none', signal: new AbortController().signal }
    ) as { tools: Array<{ name: string }> }
    expect(result.tools.map((tool) => tool.name)).toContain('google_tasks_list_tasks')
    expect(optionalToolDomain('google_tasks_list_task_lists')).toBe('planning')
  })
})
