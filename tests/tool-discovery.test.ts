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

  it('finds Outlook Calendar events from natural language calendar requests', async () => {
    const registry = new ToolRegistry()
      .register(catalogTool('microsoft_calendar_list_events', 'List events from the connected Outlook Calendar.'))
    const discovery = createToolDiscoveryTool(registry)
    const result = await discovery.run(
      { query: 'show my Outlook meetings', limit: 4 },
      { kind: 'none', signal: new AbortController().signal }
    ) as { tools: Array<{ name: string }> }
    expect(result.tools.map((tool) => tool.name)).toContain('microsoft_calendar_list_events')
    expect(optionalToolDomain('microsoft_calendar_list_events')).toBe('calendar')
  })

  it('finds the approval-gated email follow-up task for email task requests', async () => {
    const registry = new ToolRegistry()
      .register(catalogTool('create_email_followup_task', 'Create a local Today task from a selected Gmail or Outlook email after approval.'))
      .register(catalogTool('create_task', 'Create a local Today task after approval.'))
    const discovery = createToolDiscoveryTool(registry)
    const result = await discovery.run(
      { query: 'make a task from this email', limit: 2 },
      { kind: 'none', signal: new AbortController().signal }
    ) as { tools: Array<{ name: string }> }

    expect(result.tools[0]?.name).toBe('create_email_followup_task')
    expect(optionalToolDomain('create_email_followup_task')).toBe('email')
  })

  it('finds connected-task send workflows from natural language', async () => {
    const registry = new ToolRegistry()
      .register(catalogTool('google_tasks_create_from_today_task', 'Send one open local Today task to a selected Google Tasks list after approval.'))
      .register(catalogTool('google_tasks_sync_today_task', 'Sync or update local edits to the existing Google Tasks item linked to one local Today task after approval.'))
      .register(catalogTool('microsoft_todo_create_from_today_task', 'Send one open local Today task to a selected Microsoft To Do list after approval.'))
      .register(catalogTool('microsoft_todo_sync_today_task', 'Sync or update local edits to the existing Microsoft To Do item linked to one local Today task after approval.'))
    const discovery = createToolDiscoveryTool(registry)
    const google = await discovery.run({ query: 'send my Today task to Google Tasks' }, { kind: 'none', signal: new AbortController().signal }) as { tools: Array<{ name: string }> }
    const googleUpdate = await discovery.run({ query: 'update the linked Google task with my local edits' }, { kind: 'none', signal: new AbortController().signal }) as { tools: Array<{ name: string }> }
    const microsoft = await discovery.run({ query: 'copy my Today task to Microsoft To Do' }, { kind: 'none', signal: new AbortController().signal }) as { tools: Array<{ name: string }> }
    const microsoftUpdate = await discovery.run({ query: 'update the linked Microsoft To Do task with my local edits' }, { kind: 'none', signal: new AbortController().signal }) as { tools: Array<{ name: string }> }

    expect(google.tools[0]?.name).toBe('google_tasks_create_from_today_task')
    expect(googleUpdate.tools[0]?.name).toBe('google_tasks_sync_today_task')
    expect(microsoft.tools[0]?.name).toBe('microsoft_todo_create_from_today_task')
    expect(microsoftUpdate.tools[0]?.name).toBe('microsoft_todo_sync_today_task')
    expect(optionalToolDomain('microsoft_todo_create_from_today_task')).toBe('planning')
  })

  it('finds local prep-task creation from calendar event requests', async () => {
    const registry = new ToolRegistry()
      .register(catalogTool('create_calendar_prep_task', 'Create a local prep task from a selected Outlook Calendar event after approval.'))
    const discovery = createToolDiscoveryTool(registry)
    const result = await discovery.run(
      { query: 'make a prep task from my Outlook meeting' },
      { kind: 'none', signal: new AbortController().signal }
    ) as { tools: Array<{ name: string }> }

    expect(result.tools[0]?.name).toBe('create_calendar_prep_task')
    expect(optionalToolDomain('create_calendar_prep_task')).toBe('calendar')
  })
})
