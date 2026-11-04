import { useEffect, useState } from 'react'
import type { PublicGoogleCalendarSettings, PublicGoogleGmailSettings, PublicGoogleDriveSettings } from '../../../shared/ipc'
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
  { id: 'today', title: 'Today & Plans', category: 'Planning', description: 'Tasks, due dates, priorities, and inbox capture stay in local SQLite.', access: 'Read + approved writes', status: 'local', tone: 'teal' },
  { id: 'vault', title: 'Knowledge Vault', category: 'Knowledge', description: 'Searchable FTS5 notes, research captures, and teaching material.', access: 'Read + approved writes', status: 'local', tone: 'blue' },
  { id: 'research', title: 'Research Desk', category: 'Knowledge', description: 'Allowlisted web sources captured as untrusted local research.', access: 'HTTPS allowlist + approval', status: 'ready', tone: 'purple' },
  { id: 'files', title: 'Approved files', category: 'Workspace', description: 'Analyze text, PDFs, Word documents, and Excel workbooks inside folders you have approved.', access: 'Grant-scoped reads · model receives extracted text', status: 'local', tone: 'teal' },
  { id: 'web_search', title: 'Web Search', category: 'Knowledge', description: 'Optional Tavily source discovery with a permission card for every query.', access: 'Tavily API + per-search approval', status: 'available', tone: 'blue' },
  { id: 'browser', title: 'Interactive Browser', category: 'Web actions', description: 'Visible, isolated browser for inspecting pages and acting on exact allowlisted HTTPS domains.', access: 'Exact domain allowlist · per-action approval', status: 'available', tone: 'purple' },
  { id: 'google_calendar', title: 'Google Calendar', category: 'Planning', description: 'Optional calendar lookup and event editing through browser OAuth and one-time approval.', access: 'Owned event scope + approval', status: 'available', tone: 'teal' },
  { id: 'google_gmail', title: 'Gmail', category: 'Communication', description: 'Optional message search, reading, drafts, and explicitly confirmed email sending.', access: 'Read + draft approval · typed SEND', status: 'available', tone: 'blue' },
  { id: 'google_drive', title: 'Google Drive', category: 'Work', description: 'Search and analyze selected Docs, Sheets, Slides, PDFs, DOCX, XLSX, and text files with approval for each action.', access: 'Broad read-only scope · per-action approval', status: 'available', tone: 'teal' },
  { id: 'memory', title: 'Personal Memory', category: 'Context', description: 'Approved facts are automatically recalled when relevant, with citations.', access: 'Read + approved writes', status: 'local', tone: 'amber' },
  { id: 'skills', title: 'User Skills', category: 'Context', description: 'Reusable plain-text guidance loaded only when relevant to a task.', access: 'Local library · no added permissions', status: 'local', tone: 'purple' },
  { id: 'finances', title: 'Finance Ledger', category: 'Life admin', description: 'Categorized local income and expenses; no bank access or transfers.', access: 'Read + approved writes', status: 'local', tone: 'amber' },
  { id: 'teaching', title: 'LB English Packs', category: 'Work', description: 'IELTS Academic and teaching workflows for Denizli learners.', access: 'Local templates + chat', status: 'local', tone: 'purple' },
  { id: 'drafts', title: 'Draft workspace', category: 'Communication', description: 'Local unsent email and calendar drafts only.', access: 'Approved local writes', status: 'local', tone: 'blue' }
]

export function IntegrationsView({ onOpen, googleCalendarSettings, googleGmailSettings, googleDriveSettings }: {
  onOpen: (id: string) => void
  googleCalendarSettings: PublicGoogleCalendarSettings | null
  googleGmailSettings: PublicGoogleGmailSettings | null
  googleDriveSettings: PublicGoogleDriveSettings | null
}): React.JSX.Element {
  const [servers, setServers] = useState<McpServerInfo[]>([])
  useEffect(() => { void window.assist.getMcpServers().then(setServers) }, [])
  const connected = servers.filter((server) => server.status === 'connected').length

  return <div className="integrations-view"><div className="integrations-header"><div><span className="eyebrow">Capability map</span><h2>Integrations</h2><p>See what Mike Assist can use, where data goes, and which actions still need your approval. Nothing is connected silently.</p></div><span className="integration-summary">{connected} MCP connected · {INTEGRATIONS.filter((item) => item.status === 'local').length} local</span></div><div className="integration-notice"><strong>Consent by capability</strong><span>Read-only context can inform the coach. Persistent changes and external actions continue through the permission gateway.</span></div><div className="integration-grid">{INTEGRATIONS.map((item) => {
    const calendarConnected = item.id === 'google_calendar' && googleCalendarSettings?.connected === true
    const calendarNeedsReconnect = item.id === 'google_calendar' && !googleCalendarSettings?.connected && googleCalendarSettings?.tokenStored === true
    const gmailConnected = item.id === 'google_gmail' && googleGmailSettings?.connected === true
    const gmailNeedsReconnect = item.id === 'google_gmail' && !googleGmailSettings?.connected && googleGmailSettings?.tokenStored === true
    const driveConnected = item.id === 'google_drive' && googleDriveSettings?.connected === true
    const driveNeedsReconnect = item.id === 'google_drive' && !googleDriveSettings?.connected && googleDriveSettings?.tokenStored === true
    const connectedStatus = calendarConnected || gmailConnected || driveConnected
    const reconnectStatus = calendarNeedsReconnect || gmailNeedsReconnect || driveNeedsReconnect
    const status = connectedStatus ? 'ready' : item.status
    const statusLabel = connectedStatus ? 'connected' : reconnectStatus ? 'reconnect' : status === 'local' ? 'on device' : status === 'available' ? 'optional' : 'ready'
    return <article className="integration-card" key={item.id}><div className="integration-card-top"><span className={`integration-dot tone-${item.tone}`} /><span className="integration-category">{item.category}</span><span className={`integration-status integration-${status}`}>{statusLabel}</span></div><h3>{item.title}</h3><p>{item.description}</p><div className="integration-access">{item.access}</div><button className="ghost-button" type="button" onClick={() => onOpen(item.id)}>{item.id === 'helper' ? 'Use in Chat' : item.id === 'files' ? 'Manage folders' : item.id === 'drafts' || item.id === 'web_search' || item.id === 'browser' || item.id === 'google_calendar' || item.id === 'google_gmail' || item.id === 'google_drive' ? 'Open settings' : 'Open'}</button></article>
  })}</div><section className="integration-mcp"><div className="integration-mcp-head"><div><span className="eyebrow">External connectors</span><h3>MCP servers</h3><p>Only servers you configure are listed. Server results are untrusted and every MCP tool call asks.</p></div><button className="ghost-button" type="button" onClick={() => onOpen('mcp')}>Manage MCP</button></div>{servers.length === 0 ? <p className="muted">No MCP servers configured.</p> : <div className="integration-server-list">{servers.map((server) => <div className="integration-server" key={server.id}><span className={`integration-dot tone-${server.status === 'connected' ? 'teal' : 'amber'}`} /><strong>{server.name}</strong><code>{server.transport}</code><span className="muted">{server.status} · {server.tools.length} tools</span></div>)}</div>}</section></div>
}
