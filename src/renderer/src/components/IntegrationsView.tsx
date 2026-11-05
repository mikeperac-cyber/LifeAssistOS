import { useEffect, useState } from 'react'
import type { PublicGoogleCalendarSettings, PublicGoogleGmailSettings, PublicGoogleDriveSettings, PublicGoogleTasksSettings, PublicMicrosoftTodoSettings, PublicMicrosoftCalendarSettings, PublicMicrosoftMailSettings, PublicMicrosoftOneDriveSettings, PublicNotionSettings } from '../../../shared/ipc'
import type { McpServerInfo } from '../../../shared/types'
export { resolveIntegrationTargetView } from '../navigation'

interface IntegrationCard {
  id: string
  title: string
  category: string
  description: string
  access: string
  status: 'ready' | 'local' | 'available'
  tone: 'teal' | 'blue' | 'purple' | 'amber'
}

const INTEGRATIONS: IntegrationCard[] = [
  { id: 'helper', title: 'Isolated Helper', category: 'Assistant', description: 'Focused research and review through the configured model, with approval before sharing the task and a read-only tool ceiling.', access: 'Per-task approval · scoped read-only access', status: 'ready', tone: 'purple' },
  { id: 'today', title: 'Today & Plans', category: 'Planning', description: 'Local tasks, due dates, priorities, and inbox capture, with approved one-time task sends to Google Tasks and Microsoft To Do.', access: 'Local approved writes · connected task reads and sends ask each time', status: 'local', tone: 'teal' },
  { id: 'vault', title: 'Knowledge Vault', category: 'Knowledge', description: 'Searchable FTS5 notes, research captures, and teaching material.', access: 'Read + approved writes', status: 'local', tone: 'blue' },
  { id: 'research', title: 'Research Desk', category: 'Knowledge', description: 'Allowlisted web sources captured as untrusted local research.', access: 'HTTPS allowlist + approval', status: 'ready', tone: 'purple' },
  { id: 'files', title: 'Approved files', category: 'Workspace', description: 'Analyze text, PDFs, Word documents, and Excel workbooks inside folders you have approved.', access: 'Grant-scoped reads · model receives extracted text', status: 'local', tone: 'teal' },
  { id: 'web_search', title: 'Web Search', category: 'Knowledge', description: 'Optional Tavily source discovery with a permission card for every query.', access: 'Tavily API + per-search approval', status: 'available', tone: 'blue' },
  { id: 'notion', title: 'Notion', category: 'Knowledge', description: 'Search shared page titles and read selected page content. Page changes are not available.', access: 'Read-only token · approval for every search and page read', status: 'available', tone: 'purple' },
  { id: 'browser', title: 'Interactive Browser', category: 'Web actions', description: 'Visible, isolated browser for inspecting pages and acting on exact allowlisted HTTPS domains.', access: 'Exact domain allowlist · per-action approval', status: 'available', tone: 'purple' },
  { id: 'google_calendar', title: 'Google Calendar', category: 'Planning', description: 'View today’s events, create local prep tasks, or open a meeting-prep draft that can use approved Drive files and local notes.', access: 'Owned event scope · approval for reads, changes, task creation, and Drive access', status: 'available', tone: 'teal' },
  { id: 'google_gmail', title: 'Gmail', category: 'Communication', description: 'Search and read messages in Chat, create drafts or send with typed confirmation, and add local follow-up tasks from Today.', access: 'Read + draft approval · typed SEND · separate local task approval', status: 'available', tone: 'blue' },
  { id: 'google_drive', title: 'Google Drive', category: 'Work', description: 'Search and read selected files in Cloud Files or Chat. Docs, Sheets, Slides, PDFs, DOCX, XLSX, and supported text files ask for approval each time.', access: 'Broad read-only scope · per-action approval', status: 'available', tone: 'teal' },
  { id: 'google_tasks', title: 'Google Tasks', category: 'Planning', description: 'View open tasks from a selected Google Tasks list and send local Today tasks into that list.', access: 'OAuth tasks · approval for every read and task send; existing read-only connections must reconnect', status: 'available', tone: 'blue' },
  { id: 'microsoft_todo', title: 'Microsoft To Do', category: 'Planning', description: 'View open tasks from a selected Microsoft To Do list and send local Today tasks into that list.', access: 'Delegated Tasks.ReadWrite · approval for every read and task send; existing read-only connections must reconnect', status: 'available', tone: 'blue' },
  { id: 'microsoft_calendar', title: 'Outlook Calendar', category: 'Planning', description: 'View Outlook events, create local prep tasks, or open a meeting-prep draft that can use approved Drive files and local notes.', access: 'Delegated Calendars.ReadBasic · approval for event pages, local tasks, and Drive access', status: 'available', tone: 'teal' },
  { id: 'microsoft_mail', title: 'Outlook Mail', category: 'Communication', description: 'Search and read selected messages in Chat, or add local follow-up tasks from Today. Sending is not available.', access: 'Delegated Mail.Read · approval for each search, message read, and local task', status: 'available', tone: 'blue' },
  { id: 'microsoft_onedrive', title: 'Microsoft OneDrive', category: 'Work', description: 'Search and read selected PDF, DOCX, XLSX, and supported text files in Cloud Files or Chat. File changes and uploads are not available.', access: 'Delegated Files.Read · approval for each search and file read', status: 'available', tone: 'teal' },
  { id: 'memory', title: 'Personal Memory', category: 'Context', description: 'Approved facts are automatically recalled when relevant, with citations.', access: 'Read + approved writes', status: 'local', tone: 'amber' },
  { id: 'skills', title: 'User Skills', category: 'Context', description: 'Reusable plain-text guidance loaded only when relevant to a task.', access: 'Local library · no added permissions', status: 'local', tone: 'purple' },
  { id: 'finances', title: 'Finance Ledger', category: 'Life admin', description: 'Categorized local income and expenses; no bank access or transfers.', access: 'Read + approved writes', status: 'local', tone: 'amber' },
  { id: 'teaching', title: 'LB English Packs', category: 'Work', description: 'IELTS Academic and teaching workflows for Denizli learners.', access: 'Local templates + chat', status: 'local', tone: 'purple' },
  { id: 'drafts', title: 'Draft workspace', category: 'Communication', description: 'Local unsent email and calendar drafts only.', access: 'Approved local writes', status: 'local', tone: 'blue' }
]

export function IntegrationsView({ onOpen, googleCalendarSettings, googleGmailSettings, googleDriveSettings, googleTasksSettings, microsoftTodoSettings, microsoftCalendarSettings, microsoftMailSettings, microsoftOneDriveSettings, notionSettings }: {
  onOpen: (id: string) => void
  googleCalendarSettings: PublicGoogleCalendarSettings | null
  googleGmailSettings: PublicGoogleGmailSettings | null
  googleDriveSettings: PublicGoogleDriveSettings | null
  googleTasksSettings: PublicGoogleTasksSettings | null
  microsoftTodoSettings: PublicMicrosoftTodoSettings | null
  microsoftCalendarSettings: PublicMicrosoftCalendarSettings | null
  microsoftMailSettings: PublicMicrosoftMailSettings | null
  microsoftOneDriveSettings: PublicMicrosoftOneDriveSettings | null
  notionSettings: PublicNotionSettings | null
}): React.JSX.Element {
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadServers = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      setServers(await window.assist.getMcpServers())
    } catch (cause) {
      setServers([])
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadServers() }, [])
  const connected = servers.filter((server) => server.status === 'connected').length

  return (
    <div className="integrations-view">
      <div className="integrations-header">
        <div>
          <span className="eyebrow">Capability map</span>
          <h2>Integrations</h2>
          <p>See what Mike Assist can use, where data goes, and which actions still need your approval. Nothing is connected silently.</p>
        </div>
        <span className="integration-summary">
          {loading ? 'Checking MCP connections…' : error ? 'MCP status unavailable' : `${connected} MCP connected · ${INTEGRATIONS.filter((item) => item.status === 'local').length} local`}
        </span>
      </div>
      <div className="integration-notice">
        <strong>Consent by capability</strong>
        <span>Read-only context can inform the coach. Persistent changes and external actions continue through the permission gateway.</span>
      </div>
      <div className="integration-grid">
        {INTEGRATIONS.map((item) => {
          const calendarConnected = item.id === 'google_calendar' && googleCalendarSettings?.connected === true
          const calendarNeedsReconnect = item.id === 'google_calendar' && !googleCalendarSettings?.connected && googleCalendarSettings?.tokenStored === true
          const gmailConnected = item.id === 'google_gmail' && googleGmailSettings?.connected === true
          const gmailNeedsReconnect = item.id === 'google_gmail' && !googleGmailSettings?.connected && googleGmailSettings?.tokenStored === true
          const driveConnected = item.id === 'google_drive' && googleDriveSettings?.connected === true
          const driveNeedsReconnect = item.id === 'google_drive' && !googleDriveSettings?.connected && googleDriveSettings?.tokenStored === true
          const tasksConnected = item.id === 'google_tasks' && googleTasksSettings?.connected === true
          const tasksNeedsReconnect = item.id === 'google_tasks' && !googleTasksSettings?.connected && googleTasksSettings?.tokenStored === true
          const microsoftTodoConnected = item.id === 'microsoft_todo' && microsoftTodoSettings?.connected === true
          const microsoftTodoNeedsReconnect = item.id === 'microsoft_todo' && !microsoftTodoSettings?.connected && microsoftTodoSettings?.tokenStored === true
          const microsoftCalendarConnected = item.id === 'microsoft_calendar' && microsoftCalendarSettings?.connected === true
          const microsoftCalendarNeedsReconnect = item.id === 'microsoft_calendar' && !microsoftCalendarSettings?.connected && microsoftCalendarSettings?.tokenStored === true
          const microsoftMailConnected = item.id === 'microsoft_mail' && microsoftMailSettings?.connected === true
          const microsoftMailNeedsReconnect = item.id === 'microsoft_mail' && !microsoftMailSettings?.connected && microsoftMailSettings?.tokenStored === true
          const microsoftOneDriveConnected = item.id === 'microsoft_onedrive' && microsoftOneDriveSettings?.connected === true
          const microsoftOneDriveNeedsReconnect = item.id === 'microsoft_onedrive' && !microsoftOneDriveSettings?.connected && microsoftOneDriveSettings?.tokenStored === true
          const notionConfigured = item.id === 'notion' && notionSettings?.ready === true
          const notionNeedsUnlock = item.id === 'notion' && notionSettings?.hasApiKey === true && notionSettings.ready === false
          const connectedStatus = calendarConnected || gmailConnected || driveConnected || tasksConnected || microsoftTodoConnected || microsoftCalendarConnected || microsoftMailConnected || microsoftOneDriveConnected
          const emailSearchConnected = (item.id === 'google_gmail' && gmailConnected) || (item.id === 'microsoft_mail' && microsoftMailConnected)
          const browseFilesConnected = (item.id === 'google_drive' && driveConnected) || (item.id === 'microsoft_onedrive' && microsoftOneDriveConnected)
          const reconnectStatus = calendarNeedsReconnect || gmailNeedsReconnect || driveNeedsReconnect || tasksNeedsReconnect || microsoftTodoNeedsReconnect || microsoftCalendarNeedsReconnect || microsoftMailNeedsReconnect || microsoftOneDriveNeedsReconnect || notionNeedsUnlock
          const status = connectedStatus || notionConfigured ? 'ready' : item.status
          const statusLabel = notionConfigured ? 'configured' : connectedStatus ? 'connected' : reconnectStatus ? (notionNeedsUnlock ? 'unlock needed' : 'reconnect') : status === 'local' ? 'on device' : status === 'available' ? 'optional' : 'ready'
          const actionLabel = emailSearchConnected
            ? 'Search email'
            : browseFilesConnected
              ? 'Browse files'
            : item.id === 'helper'
            ? 'Use in Chat'
            : item.id === 'files'
              ? 'Manage folders'
              : ['drafts', 'web_search', 'notion', 'browser', 'google_calendar', 'google_gmail', 'google_drive', 'google_tasks', 'microsoft_todo', 'microsoft_calendar', 'microsoft_mail', 'microsoft_onedrive'].includes(item.id)
                ? 'Open settings'
                : 'Open'

          return (
            <article className="integration-card" key={item.id}>
              <div className="integration-card-top">
                <span className={`integration-dot tone-${item.tone}`} />
                <span className="integration-category">{item.category}</span>
                <span className={`integration-status integration-${status}`}>{statusLabel}</span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <div className="integration-access">{item.access}</div>
              <button className="ghost-button" type="button" onClick={() => onOpen(emailSearchConnected ? 'email' : browseFilesConnected ? 'cloud_files' : item.id)}>{actionLabel}</button>
            </article>
          )
        })}
      </div>
      <section className="integration-mcp">
        <div className="integration-mcp-head">
          <div>
            <span className="eyebrow">External connectors</span>
            <h3>MCP servers</h3>
            <p>Only servers you configure are listed. Server results are untrusted and every MCP tool call asks.</p>
          </div>
          <button className="ghost-button" type="button" onClick={() => onOpen('mcp')}>Manage MCP</button>
        </div>
        {loading ? (
          <p className="muted" role="status">Loading MCP connections…</p>
        ) : error ? (
          <div className="integration-load-error">
            <p role="alert">{error}</p>
            <button className="ghost-button" type="button" onClick={() => void loadServers()}>Retry</button>
          </div>
        ) : servers.length === 0 ? (
          <p className="muted">No MCP servers configured.</p>
        ) : (
          <div className="integration-server-list">
            {servers.map((server) => (
              <div className="integration-server" key={server.id}>
                <span className={`integration-dot tone-${server.status === 'connected' ? 'teal' : 'amber'}`} />
                <strong>{server.name}</strong>
                <code>{server.transport}</code>
                <span className="muted">{server.status} · {server.tools.length} tools</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
