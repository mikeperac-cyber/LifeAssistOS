import { useMemo, useState } from 'react'
import type { AuditEvent, AuditIntegrity } from '../../../shared/types'
import type { AuditExportResult } from '../../../shared/ipc'

type Filter = 'all' | 'decisions' | 'calls' | 'changes'

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'decisions', label: 'Decisions' },
  { value: 'calls', label: 'Calls' },
  { value: 'changes', label: 'Changes' }
]

export function AuditView({
  events,
  integrity,
  onExport
}: {
  events: AuditEvent[]
  integrity: AuditIntegrity
  onExport: () => Promise<AuditExportResult>
}): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')

  const shown = useMemo(() => {
    const newestFirst = [...events].reverse()

    if (filter === 'decisions') {
      return newestFirst.filter(
        (event) =>
          event.type === 'policy.decided' ||
          event.type.startsWith('approval.') ||
          event.type === 'call.blocked'
      )
    }

    if (filter === 'calls') {
      return newestFirst.filter((event) => event.type.startsWith('call.'))
    }

    if (filter === 'changes') {
      return newestFirst.filter(
        (event) =>
          event.type.startsWith('grant.') ||
          event.type.startsWith('domain.') ||
          event.type.startsWith('conversation.') ||
          event.type.startsWith('speech.') ||
          event.type.startsWith('backup.') ||
          event.type.startsWith('onboarding.') ||
          event.type.startsWith('workflow.') ||
          event.type.startsWith('scheduled_task.') ||
          event.type.startsWith('memory.') ||
          event.type.startsWith('mcp.') ||
          event.type.startsWith('research.') ||
          event.type.startsWith('vault.') ||
          event.type.startsWith('plan.') ||
          event.type.startsWith('coaching.') ||
          event.type.startsWith('local_api.') ||
          event.type.startsWith('web_search.') ||
          event.type.startsWith('google_calendar.') ||
          event.type.startsWith('google_gmail.') ||
          event.type.startsWith('google_drive.') ||
          event.type.startsWith('google_tasks.') ||
          event.type.startsWith('microsoft_todo.') ||
          event.type.startsWith('microsoft_calendar.') ||
          event.type.startsWith('microsoft_mail.') ||
          event.type.startsWith('microsoft_onedrive.') ||
          event.type === 'skill.changed' ||
          event.type === 'settings.changed'
      )
    }

    return newestFirst
  }, [events, filter])

  async function exportLog(): Promise<void> {
    setExporting(true)
    setExportMessage('')
    try {
      const result = await onExport()
      if (result.ok) setExportMessage(`Exported ${result.fileName ?? 'audit log'}.`)
      else if (!result.cancelled) setExportMessage(result.error ?? 'Could not export the audit log.')
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="audit">
      <div className="audit-toolbar">
        <div className="segmented" role="group" aria-label="Filter audit events">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filter === option.value ? 'active' : ''}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="audit-toolbar-right">
          <span className={`integrity-badge ${integrity.valid ? 'integrity-valid' : 'integrity-invalid'}`}>
            {integrity.valid
              ? `${integrity.chainedEvents.toLocaleString()} verified · ${integrity.legacyEvents.toLocaleString()} legacy`
              : `Integrity issue${integrity.brokenEventId ? ` · ${integrity.brokenEventId.slice(0, 8)}` : ''}`}
          </span>
          <button className="ghost-button audit-export-button" type="button" onClick={() => void exportLog()} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export JSONL'}
          </button>
          <span className="audit-count">
            {events.length.toLocaleString()} event{events.length === 1 ? '' : 's'} · append-only
          </span>
          {exportMessage && <span className="audit-export-message" role="status">{exportMessage}</span>}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="audit-empty">
          <div className="audit-empty-mark">◇</div>
          <p>{auditEmptyMessage(events.length, filter)}</p>
        </div>
      ) : (
        <div className="audit-list">
          {shown.map((event) => (
            <details className="audit-row" key={event.id}>
              <summary>
                <span className="audit-time">{formatTime(event.at)}</span>
                <span className={`audit-type audit-${event.type.split('.')[0]}`}>{event.type}</span>
                <span className="audit-summary">{summarizeEvent(event)}</span>
                <span className="audit-chevron">›</span>
              </summary>
              <pre className="audit-json">{JSON.stringify(event, null, 2)}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

export function auditEmptyMessage(eventCount: number, filter: Filter): string {
  if (eventCount === 0) return 'No events yet. Every message, decision, and tool run lands here.'
  const filterLabel = FILTERS.find((option) => option.value === filter)?.label.toLocaleLowerCase() ?? 'matching'
  return `No events match the ${filterLabel} filter.`
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function summarizeEvent(event: AuditEvent): string {
  const data = event.data ?? {}

  switch (event.type) {
    case 'chat.message': {
      const tokens =
        typeof data.promptTokens === 'number' || typeof data.completionTokens === 'number'
          ? ` · ${data.promptTokens ?? 0} in / ${data.completionTokens ?? 0} out tokens`
          : ''
      const latency = typeof data.latencyMs === 'number' ? ` · ${data.latencyMs}ms` : ''
      return `${String(data.role ?? 'message')} · ${String(data.chars ?? 0)} chars${tokens}${latency}`
    }
    case 'conversation.created':
      return 'new conversation'
    case 'conversation.switched':
      return 'conversation opened'
    case 'conversation.renamed':
      return 'conversation renamed'
    case 'conversation.deleted':
      return 'conversation deleted'
    case 'call.proposed':
      return `${String(data.tool ?? 'tool')} · args ${String(data.argsHash ?? '')}`
    case 'policy.decided':
      return `${String(data.tool ?? 'tool')} → ${String(data.decision ?? 'unknown')}`
    case 'approval.requested':
      return `${String(data.tool ?? 'tool')} · waiting for you`
    case 'approval.granted':
      return `${String(data.tool ?? 'tool')} · approved${data.mode === 'session' ? ' for this chat' : ''}`
    case 'approval.session_granted':
      return `${String(data.tool ?? 'tool')} · exact action reused for this chat`
    case 'approval.denied':
      return `${String(data.tool ?? 'tool')} · denied`
    case 'approval.expired':
      return `${String(data.tool ?? 'tool')} · timed out`
    case 'approval.cancelled':
      return `${String(data.tool ?? 'tool')} · cancelled`
    case 'call.started':
      return String(data.tool ?? 'tool')
    case 'call.completed':
      return `${String(data.tool ?? 'tool')} · ${String(data.durationMs ?? 0)} ms`
    case 'call.failed':
      return `${String(data.tool ?? 'tool')} · ${String(data.error ?? 'failed')}`
    case 'call.cancelled':
      return `${String(data.tool ?? 'tool')} · cancelled`
    case 'call.blocked':
      return `${String(data.tool ?? 'tool')} · ${String(data.reason ?? 'blocked')}`
    case 'agent.step':
      return `step ${String(data.step ?? 1)} of ${String(data.max ?? 1)}`
    case 'agent.nudged':
      return String(data.reason ?? 'nudged')
    case 'agent.stopped':
      return `${String(data.reason ?? 'stopped')}${data.code ? ` · ${String(data.code)}` : ''}`
    case 'grant.added':
      return `${String(data.label ?? 'folder')} · ${String(data.access ?? 'read')}`
    case 'grant.removed':
      return String(data.label ?? 'folder removed')
    case 'grant.access_changed':
      return `${String(data.label ?? 'folder')} → ${String(data.access ?? 'read')}`
    case 'settings.changed':
      return `${String(data.model ?? 'model')} · ${String(data.contextLength ?? 0)} ctx`
    case 'local_api.requested':
      return `${String(data.route ?? 'route')} · ${String(data.status ?? 'handled')}`
    case 'local_api.enabled':
      return 'local API server enabled'
    case 'local_api.disabled':
      return 'local API server disabled'
    case 'web_search.settings_changed':
      return data.configured ? 'API key configured' : 'web search settings updated'
    case 'google_calendar.settings_changed':
      return 'Google Calendar settings updated'
    case 'google_calendar.connected':
      return 'Google Calendar OAuth connected'
    case 'google_calendar.disconnected':
      return 'Google Calendar disconnected locally'
    case 'google_gmail.settings_changed':
      return 'Gmail settings updated'
    case 'google_gmail.connected':
      return 'Gmail OAuth connected'
    case 'google_gmail.disconnected':
      return 'Gmail disconnected locally'
    case 'google_drive.settings_changed':
      return 'Google Drive settings updated'
    case 'google_drive.connected':
      return 'Google Drive OAuth connected'
    case 'google_drive.disconnected':
      return 'Google Drive disconnected locally'
    case 'google_tasks.settings_changed':
      return 'Google Tasks settings updated'
    case 'google_tasks.connected':
      return 'Google Tasks OAuth connected'
    case 'google_tasks.disconnected':
      return 'Google Tasks disconnected locally'
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
      return 'Outlook Mail OAuth connected'
    case 'microsoft_mail.disconnected':
      return 'Outlook Mail disconnected locally'
    case 'microsoft_onedrive.settings_changed':
      return 'Microsoft OneDrive settings updated'
    case 'microsoft_onedrive.connected':
      return 'Microsoft OneDrive connected'
    case 'microsoft_onedrive.disconnected':
      return 'Microsoft OneDrive disconnected locally'
    case 'domain.added':
      return `${String(data.host ?? 'domain')} · allowed`
    case 'domain.removed':
      return `${String(data.host ?? 'domain')} · removed`
    case ' speech.endpoint_changed' as any:
    case 'speech.endpoint_changed':
      return data.configured ? 'local endpoint configured' : 'voice input disabled'
    case 'backup.created':
      return 'backup snapshot created'
    case 'backup.restored':
      return 'backup snapshot restored'
    case 'onboarding.completed':
      return 'first-run guide completed'
    case 'workflow.saved':
      return `${String(data.stepCount ?? 0)} local steps saved`
    case 'workflow.removed':
      return 'saved workflow removed'
    case 'workflow.started':
      return `${String(data.stepCount ?? 0)} recorded steps started`
    case 'workflow.completed':
      return `${String(data.completedSteps ?? 0)} of ${String(data.totalSteps ?? 0)} steps · ${data.success ? 'complete' : 'stopped'}`
    case 'scheduled_task.created':
      return `scheduled task created${data.schedule ? ` (${String(data.schedule)})` : ''}`
    case 'scheduled_task.updated':
      return 'scheduled task updated'
    case 'scheduled_task.removed':
      return 'scheduled task removed'
    case 'scheduled_task.started':
      return 'scheduled task started'
    case 'scheduled_task.completed':
      return `scheduled task ${data.ok === false ? 'failed' : 'completed'}`
    case 'skill.changed':
      return `${String(data.operation ?? 'updated')} · ${String(data.skillId ?? 'skill')}`
    case 'memory.updated':
      return 'memory fact edited'
    case 'memory.archived':
      return 'memory fact archived'
    case 'memory.deleted':
      return 'memory fact deleted'
    case 'memory.recalled':
      return `${String(data.facts ?? 0)} fact(s) matched`
    case 'mcp.server_added':
      return `MCP server added${data.transport ? ` · ${String(data.transport)}` : ''}`
    case 'mcp.server_removed':
      return 'MCP server removed'
    case 'mcp.connected':
      return `MCP connected${data.tools !== undefined ? ` · ${String(data.tools)} tools` : ''}`
    case 'mcp.disconnected':
      return 'MCP server disconnected'
    case 'mcp.failed':
      return `MCP error${data.error ? ` · ${String(data.error)}` : ''}`
    case 'mcp.tools_changed':
      return `MCP tools refreshed${data.tools !== undefined ? ` · ${String(data.tools)} tools` : ''}`
    case 'research.project_created':
      return 'research project created'
    case 'research.project_removed':
      return 'research project removed'
    case 'research.source_added':
      return `research source saved${data.chars ? ` · ${String(data.chars)} chars` : ''}`
    case 'research.source_removed':
      return 'research source removed'
    case 'vault.document_created':
      return `vault document created${data.chars ? ` · ${String(data.chars)} chars` : ''}`
    case 'vault.document_updated':
      return 'vault document updated'
    case 'vault.document_deleted':
      return 'vault document deleted'
    case 'plan.task_created':
      return `task created${data.priority ? ` · ${String(data.priority)}` : ''}`
    case 'plan.task_imported':
      return `task copied from ${data.provider === 'microsoft_todo' ? 'Microsoft To Do' : 'Google Tasks'}`
    case 'plan.task_updated':
      return 'task updated'
    case 'plan.task_completed':
      return 'task marked complete'
    case 'plan.reminder_notified':
      return 'due task reminder shown'
    case 'plan.inbox_captured':
      return 'inbox item captured'
    case 'plan.inbox_converted':
      return 'inbox item converted to task'
    case 'coaching.profile_updated':
      return `coaching profile updated${data.area ? ` · ${String(data.area)}` : ''}`
    case 'coaching.goal_created':
      return `coaching goal created${data.area ? ` · ${String(data.area)}` : ''}`
    case 'coaching.goal_updated':
      return 'coaching goal updated'
    case 'coaching.goal_completed':
      return 'coaching goal completed'
    case 'coaching.journal_saved':
      return `coaching journal saved${data.kind ? ` · ${String(data.kind)}` : ''}`
    default:
      return event.type
  }
}
