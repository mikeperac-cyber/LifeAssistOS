import { describe, expect, it } from 'vitest'
import type { AuditEvent, AuditType } from '../src/shared/types'
import { describeEvent } from '../src/renderer/src/components/ActivityView'
import { summarizeEvent } from '../src/renderer/src/components/AuditView'
import { resolveIntegrationTargetView } from '../src/renderer/src/components/IntegrationsView'

const ALL_AUDIT_TYPES: AuditType[] = [
  'chat.message',
  'conversation.created',
  'conversation.switched',
  'conversation.renamed',
  'conversation.deleted',
  'call.proposed',
  'policy.decided',
  'approval.requested',
  'approval.granted',
  'approval.denied',
  'approval.expired',
  'call.started',
  'call.completed',
  'call.failed',
  'call.cancelled',
  'call.blocked',
  'approval.cancelled',
  'approval.session_granted',
  'agent.step',
  'agent.nudged',
  'agent.stopped',
  'grant.added',
  'grant.removed',
  'grant.access_changed',
  'settings.changed',
  'local_api.requested',
  'local_api.enabled',
  'local_api.disabled',
  'web_search.settings_changed',
  'notion.settings_changed',
  'github.settings_changed',
  'google_calendar.settings_changed',
  'google_calendar.connected',
  'google_calendar.disconnected',
  'google_gmail.settings_changed',
  'google_gmail.connected',
  'google_gmail.disconnected',
  'google_drive.settings_changed',
  'google_drive.connected',
  'google_drive.disconnected',
  'google_tasks.settings_changed',
  'google_tasks.connected',
  'google_tasks.disconnected',
  'microsoft_todo.settings_changed',
  'microsoft_todo.connected',
  'microsoft_todo.disconnected',
  'microsoft_calendar.settings_changed',
  'microsoft_calendar.connected',
  'microsoft_calendar.disconnected',
  'domain.added',
  'domain.removed',
  'backup.created',
  'backup.restored',
  'speech.endpoint_changed',
  'onboarding.completed',
  'workflow.saved',
  'workflow.removed',
  'workflow.started',
  'workflow.completed',
  'scheduled_task.created',
  'scheduled_task.updated',
  'scheduled_task.removed',
  'scheduled_task.started',
  'scheduled_task.completed',
  'skill.changed',
  'memory.updated',
  'memory.archived',
  'memory.deleted',
  'memory.recalled',
  'mcp.server_added',
  'mcp.server_removed',
  'mcp.connected',
  'mcp.disconnected',
  'mcp.failed',
  'mcp.tools_changed',
  'research.project_created',
  'research.project_removed',
  'research.source_added',
  'research.source_removed',
  'vault.document_created',
  'vault.document_updated',
  'vault.document_deleted',
  'plan.task_created',
  'plan.task_imported',
  'plan.task_updated',
  'plan.task_completed',
  'plan.reminder_notified',
  'plan.inbox_captured',
  'plan.inbox_converted',
  'coaching.profile_updated',
  'coaching.goal_created',
  'coaching.goal_updated',
  'coaching.goal_completed',
  'coaching.journal_saved'
]

function sampleEvent(type: AuditType): AuditEvent {
  return {
    id: `evt-${type}`,
    at: '2026-11-03T18:00:00.000Z',
    sessionId: 'sess-1',
    type,
    data: {
      role: 'user',
      chars: 42,
      tool: 'read_file',
      decision: 'allow',
      argsHash: 'abc12345',
      durationMs: 12,
      error: 'timeout',
      reason: 'denied',
      step: 1,
      max: 8,
      label: 'Workspace',
      access: 'read-write',
      model: 'qwen',
      contextLength: 8192,
      host: 'example.com',
      stepCount: 2,
      completedSteps: 2,
      totalSteps: 2,
      success: true,
      operation: 'saved',
      skillId: 'test-skill',
      facts: 2
    }
  }
}

describe('IntegrationsView routing', () => {
  it('routes both finance and finances card ids to the finances view', () => {
    expect(resolveIntegrationTargetView('finances')).toBe('finances')
    expect(resolveIntegrationTargetView('finance')).toBe('finances')
    expect(resolveIntegrationTargetView('helper')).toBe('chat')
    expect(resolveIntegrationTargetView('research')).toBe('research')
    expect(resolveIntegrationTargetView('today')).toBe('today')
    expect(resolveIntegrationTargetView('email')).toBe('email')
    expect(resolveIntegrationTargetView('cloud_files')).toBe('cloud_files')
    expect(resolveIntegrationTargetView('vault')).toBe('vault')
    expect(resolveIntegrationTargetView('files')).toBe('settings')
    expect(resolveIntegrationTargetView('mcp')).toBe('settings')
    expect(resolveIntegrationTargetView('notion')).toBe('settings')
    expect(resolveIntegrationTargetView('github')).toBe('settings')
  })
})

describe('ActivityView and AuditView event formatters', () => {
  it('describes every AuditType with a human-friendly sentence rather than raw dot-key', () => {
    const rawFallbacks: string[] = []
    for (const type of ALL_AUDIT_TYPES) {
      const text = describeEvent(sampleEvent(type))
      if (text === type || !text.trim()) {
        rawFallbacks.push(type)
      }
    }
    expect(rawFallbacks).toEqual([])
  })

  it('summarizes every AuditType with a non-empty summary in AuditView', () => {
    const emptySummaries: string[] = []
    for (const type of ALL_AUDIT_TYPES) {
      const text = summarizeEvent(sampleEvent(type))
      if (!text.trim()) {
        emptySummaries.push(type)
      }
    }
    expect(emptySummaries).toEqual([])
  })
})
