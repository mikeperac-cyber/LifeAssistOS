import { describe, expect, it } from 'vitest'
import { defaultPolicy, resolveDecision } from '../src/core/gateway/policy'
import { ToolRegistry } from '../src/core/registry'
import { fsTools, createWriteFileTool, createFileCheckpointTools } from '../src/tools/fs'
import { readPdfTool } from '../src/tools/pdf'
import { readOfficeDocumentTool } from '../src/tools/office-document'
import { noteTools } from '../src/tools/notes'
import { projectOverviewTool } from '../src/tools/project'
import { runCommandTool } from '../src/tools/terminal'
import { executeCodeTool } from '../src/tools/code-execution'
import { createFinanceTools } from '../src/tools/finance'
import { createMemoryTools } from '../src/tools/memory'
import { createSkillTools } from '../src/tools/skills'
import { createWebFetchTool } from '../src/tools/web'
import { createBrowserTools } from '../src/tools/browser'
import { createWebSearchTool } from '../src/tools/web-search'
import { createGoogleCalendarTools } from '../src/tools/google-calendar'
import { createGoogleGmailTools } from '../src/tools/google-gmail'
import { createGoogleDriveTools } from '../src/tools/google-drive'
import { createGoogleTasksTools } from '../src/tools/google-tasks'
import { createMicrosoftTodoTools } from '../src/tools/microsoft-todo'
import { createCommandCenterTools } from '../src/tools/command-center'
import { createCoachingTools } from '../src/tools/coaching'
import { createScheduledTaskTools } from '../src/tools/scheduled-tasks'
import { createConversationSearchTool } from '../src/tools/conversation-search'
import { createDelegationTool, createDelegationTasksTool } from '../src/tools/delegation'
import { createToolDiscoveryTool } from '../src/tools/tool-discovery'

describe('defaultPolicy completeness', () => {
  it('configures execute_code as ask rather than falling back to default block', () => {
    const res = resolveDecision(executeCodeTool.name, executeCodeTool.risk, defaultPolicy)
    expect(res.decision).toBe('ask')
  })

  it('has an explicit policy entry for every built-in registered tool', () => {
    const registry = new ToolRegistry()
    const dummyStore = {} as any
    for (const tool of fsTools) {
      if (tool.name !== 'write_file') registry.register(tool)
    }
    registry.register(createWriteFileTool(dummyStore))
    for (const tool of createFileCheckpointTools(dummyStore)) registry.register(tool)
    registry.register(readPdfTool)
    registry.register(readOfficeDocumentTool)
    for (const tool of noteTools) registry.register(tool)
    registry.register(projectOverviewTool)
    registry.register(runCommandTool)
    registry.register(executeCodeTool)
    for (const tool of createFinanceTools(dummyStore)) registry.register(tool)
    for (const tool of createMemoryTools(dummyStore)) registry.register(tool)
    for (const tool of createSkillTools(dummyStore)) registry.register(tool)
    registry.register(createWebFetchTool(() => false))
    for (const tool of createBrowserTools(dummyStore, () => false)) registry.register(tool)
    registry.register(createWebSearchTool(() => undefined))
    for (const tool of createGoogleCalendarTools(dummyStore)) registry.register(tool)
    for (const tool of createGoogleGmailTools(dummyStore)) registry.register(tool)
    for (const tool of createGoogleDriveTools(dummyStore)) registry.register(tool)
    for (const tool of createGoogleTasksTools(dummyStore, dummyStore)) registry.register(tool)
    for (const tool of createMicrosoftTodoTools(dummyStore, dummyStore)) registry.register(tool)
    for (const tool of createCommandCenterTools(dummyStore, dummyStore)) registry.register(tool)
    for (const tool of createCoachingTools(dummyStore)) registry.register(tool)
    for (const tool of createScheduledTaskTools(dummyStore)) registry.register(tool)
    registry.register(createConversationSearchTool(dummyStore, () => 'assistant'))
    registry.register(createDelegationTool(async () => ({})))
    registry.register(createDelegationTasksTool(async () => ({})))
    registry.register(createToolDiscoveryTool(registry))

    const missing: string[] = []
    for (const tool of registry.list()) {
      if (!(tool.name in defaultPolicy.tools)) {
        missing.push(tool.name)
      }
    }

    expect(missing).toEqual([])
    expect(resolveDecision('create_email_followup_task', 'write', defaultPolicy).decision).toBe('ask')
    expect(resolveDecision('create_calendar_prep_task', 'write', defaultPolicy).decision).toBe('ask')
    expect(resolveDecision('google_tasks_create_from_today_task', 'external', defaultPolicy).decision).toBe('ask')
    expect(resolveDecision('microsoft_todo_create_from_today_task', 'external', defaultPolicy).decision).toBe('ask')
    expect(resolveDecision('clear_task_export_retry_guard', 'write', defaultPolicy).decision).toBe('ask')
  })
})
