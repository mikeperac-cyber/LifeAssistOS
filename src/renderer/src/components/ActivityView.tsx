import { useMemo, useState } from 'react'
import type { AuditEvent, AuditIntegrity } from '../../../shared/types'
import type { AuditExportResult } from '../../../shared/ipc'
import { AuditView } from './AuditView'

/**
 * Friendly, content-free activity feed over the audit trail. "Detailed log"
 * switches to the exact append-only event list (AuditView). Nothing here
 * reveals message or fact contents — the audit trail stores no content.
 */
export function ActivityView({
  events,
  integrity,
  onExport
}: {
  events: AuditEvent[]
  integrity: AuditIntegrity
  onExport: () => Promise<AuditExportResult>
}): React.JSX.Element {
  const [showRaw, setShowRaw] = useState(false)

  const newestFirst = useMemo(() => [...events].reverse().slice(0, 400), [events])

  if (showRaw) {
    return <AuditView events={events} integrity={integrity} onExport={onExport} />
  }

  return (
    <div className="activity">
      <div className="activity-toolbar">
        <span className="audit-count">
          {events.length.toLocaleString()} event{events.length === 1 ? '' : 's'} · newest first
        </span>
        <div className="audit-toolbar-right">
          <span className={`integrity-badge ${integrity.valid ? 'integrity-valid' : 'integrity-invalid'}`}>
            {integrity.valid ? 'Log verified' : 'Integrity issue'}
          </span>
          <button className="ghost-button" type="button" onClick={() => setShowRaw(true)}>
            Detailed log
          </button>
        </div>
      </div>

      <ul className="activity-list">
        {newestFirst.map((event) => (
          <li key={event.id} className={`activity-item tone-${toneOf(event.type)}`}>
            <span className="activity-dot" />
            <span className="activity-text">{describeEvent(event)}</span>
            <time className="muted">{formatTime(event.at)}</time>
          </li>
        ))}
      </ul>

      {events.length === 0 && (
        <div className="audit-empty">
          <div className="audit-empty-mark">◇</div>
          <p>Nothing has happened yet. Everything Mike Assist does shows up here.</p>
        </div>
      )}
    </div>
  )
}

type Tone = 'good' | 'warn' | 'bad' | 'neutral'

function toneOf(type: string): Tone {
  if (type === 'approval.denied' || type === 'call.failed' || type === 'call.blocked' || type === 'mcp.failed') return 'bad'
  if (type === 'policy.decided' || type === 'approval.requested' || type.startsWith('approval.')) return 'warn'
  if (
    type === 'call.completed' ||
    type === 'backup.created' ||
    type === 'plan.task_completed' ||
    type === 'coaching.goal_completed' ||
    type === 'scheduled_task.completed'
  ) {
    return 'good'
  }
  return 'neutral'
}

export function describeEvent(event: AuditEvent): string {
  const data = event.data ?? {}
  const tool = typeof data.tool === 'string' ? data.tool : null
  const decision = typeof data.decision === 'string' ? data.decision : null

  switch (event.type) {
    case 'chat.message': {
      const tokens =
        typeof data.promptTokens === 'number' || typeof data.completionTokens === 'number'
          ? ` (${data.promptTokens ?? 0} in / ${data.completionTokens ?? 0} out tokens)`
          : ''
      return `Chat message exchanged${tokens}`
    }
    case 'conversation.created':
      return 'New conversation started'
    case 'conversation.switched':
      return 'Switched conversations'
    case 'conversation.renamed':
      return 'Conversation renamed'
    case 'conversation.deleted':
      return 'Conversation deleted'
    case 'call.proposed':
      return `Assistant proposed a tool: ${tool ?? 'unknown'}`
    case 'policy.decided':
      return `Gateway decided ${decision ?? 'unknown'} for ${tool ?? 'a tool'}`
    case 'approval.requested':
      return tool ? `Asked you to approve ${tool}` : 'Asked for approval'
    case 'approval.granted':
      return data.mode === 'session'
        ? `Approved ${tool ?? 'action'} for this chat`
        : `Approved ${tool ?? 'action'} once`
    case 'approval.denied':
      return `You denied ${tool ?? 'the action'}`
    case 'approval.cancelled':
      return 'Approval was cancelled'
    case 'approval.expired':
      return 'Approval timed out'
    case 'approval.session_granted':
      return `Reused this-chat approval for ${tool ?? 'a tool'}`
    case 'call.started':
      return `Started ${tool ?? 'tool'}`
    case 'call.completed':
      return `Completed ${tool ?? 'tool'}`
    case 'call.failed':
      return `${tool ?? 'Tool'} failed`
    case 'call.cancelled':
      return `${tool ?? 'Tool'} was cancelled`
    case 'call.blocked':
      return `Blocked a call to ${tool ?? 'an unapproved tool'}`
    case 'agent.step':
      return 'Assistant step'
    case 'agent.nudged':
      return 'Assistant nudged'
    case 'agent.stopped':
      return 'Assistant stopped'
    case 'grant.added':
      return 'Approved folder added'
    case 'grant.removed':
      return 'Approved folder removed'
    case 'grant.access_changed':
      return 'Approved folder access changed'
    case 'settings.changed':
      return 'Settings changed'
    case 'local_api.requested':
      return 'Local API request handled'
    case 'local_api.enabled':
      return 'Local API server enabled'
    case 'local_api.disabled':
      return 'Local API server disabled'
    case 'web_search.settings_changed':
      return 'Web search settings updated'
    case 'notion.settings_changed':
      return 'Notion connection settings updated'
    case 'google_calendar.settings_changed':
      return 'Google Calendar settings updated'
    case 'google_calendar.connected':
      return 'Google Calendar connected'
    case 'google_calendar.disconnected':
      return 'Google Calendar disconnected locally'
    case 'google_gmail.settings_changed':
      return 'Gmail settings updated'
    case 'google_gmail.connected':
      return 'Gmail connected'
    case 'google_gmail.disconnected':
      return 'Gmail disconnected locally'
    case 'google_drive.settings_changed':
      return 'Google Drive settings updated'
    case 'google_drive.connected':
      return 'Google Drive connected'
    case 'google_drive.disconnected':
      return 'Google Drive disconnected locally'
    case 'google_tasks.settings_changed':
      return 'Google Tasks settings updated'
    case 'google_tasks.connected':
      return 'Google Tasks connected'
    case 'google_tasks.disconnected':
      return 'Google Tasks disconnected'
    case 'microsoft_todo.settings_changed':
      return 'Microsoft To Do settings updated'
    case 'microsoft_todo.connected':
      return 'Microsoft To Do connected'
    case 'microsoft_todo.disconnected':
      return 'Microsoft To Do disconnected locally'
    case 'microsoft_calendar.settings_changed':
      return 'Outlook Calendar settings updated'
    case 'microsoft_calendar.connected':
      return 'Outlook Calendar connected'
    case 'microsoft_calendar.disconnected':
      return 'Outlook Calendar disconnected locally'
    case 'microsoft_mail.settings_changed':
      return 'Outlook Mail settings updated'
    case 'microsoft_mail.connected':
      return 'Outlook Mail connected'
    case 'microsoft_mail.disconnected':
      return 'Outlook Mail disconnected locally'
    case 'domain.added':
      return 'Web domain allowed'
    case 'domain.removed':
      return 'Web domain removed'
    case 'backup.created':
      return 'Backup created'
    case 'backup.restored':
      return 'Backup restored'
    case 'plan.task_created':
      return 'Today task created'
    case 'plan.task_imported':
      return `Task copied from ${event.data.provider === 'microsoft_todo' ? 'Microsoft To Do' : 'Google Tasks'}`
    case 'plan.task_updated':
      return 'Today task updated'
    case 'plan.task_completed':
      return 'Today task completed'
    case 'plan.reminder_notified':
      return 'Task reminder shown'
    case 'plan.inbox_captured':
      return 'Item captured to Today inbox'
    case 'plan.inbox_converted':
      return 'Inbox item converted to task'
    case 'speech.endpoint_changed':
      return 'Voice input endpoint changed'
    case 'onboarding.completed':
      return 'First-run setup completed'
    case 'workflow.saved':
      return 'Workflow saved'
    case 'workflow.removed':
      return 'Workflow removed'
    case 'workflow.started':
      return 'Workflow started'
    case 'workflow.completed':
      return 'Workflow completed'
    case 'scheduled_task.created':
      return 'Scheduled task created'
    case 'scheduled_task.updated':
      return 'Scheduled task updated'
    case 'scheduled_task.removed':
      return 'Scheduled task removed'
    case 'scheduled_task.started':
      return 'Scheduled task started'
    case 'scheduled_task.completed':
      return 'Scheduled task completed'
    case 'skill.changed':
      return `Skill ${String(data.operation ?? 'changed')}`
    case 'memory.updated':
      return 'A memory fact was edited'
    case 'memory.archived':
      return 'A memory fact was archived'
    case 'memory.deleted':
      return 'A memory fact was permanently deleted'
    case 'memory.recalled':
      return typeof data.facts === 'number' && data.facts > 0
        ? `Looked up memory and matched ${data.facts} fact${data.facts === 1 ? '' : 's'}`
        : 'Looked up memory'
    case 'mcp.server_added':
      return 'MCP server added'
    case 'mcp.server_removed':
      return 'MCP server removed'
    case 'mcp.connected':
      return 'MCP server connected'
    case 'mcp.disconnected':
      return 'MCP server disconnected'
    case 'mcp.failed':
      return 'MCP server connection failed'
    case 'mcp.tools_changed':
      return 'MCP server tools refreshed'
    case 'research.project_created':
      return 'Research project created'
    case 'research.project_removed':
      return 'Research project removed'
    case 'research.source_added':
      return 'Research source added'
    case 'research.source_removed':
      return 'Research source removed'
    case 'vault.document_created':
      return 'Vault document created'
    case 'vault.document_updated':
      return 'Vault document updated'
    case 'vault.document_deleted':
      return 'Vault document deleted'
    case 'coaching.profile_updated':
      return 'Coaching profile updated'
    case 'coaching.goal_created':
      return 'Coaching goal created'
    case 'coaching.goal_updated':
      return 'Coaching goal updated'
    case 'coaching.goal_completed':
      return 'Coaching goal completed'
    case 'coaching.journal_saved':
      return 'Coaching journal entry saved'
    default:
      return event.type
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
