import { useEffect, useRef, useState } from 'react'
import type {
  GoogleGmailSearchResult,
  PublicGoogleGmailSettings,
  PublicMicrosoftMailSettings,
  MicrosoftMailSearchResult
} from '../../../shared/ipc'
import type { EmailFollowupTaskInput } from '../../../shared/ipc'
import type { EmailTaskProvider, PlanTask } from '../../../shared/types'

interface EmailPanelMessage {
  id: string
  subject: string
  sender?: string
  receivedAt?: string
  snippet?: string
}

interface EmailPanelReadResult<TSettings extends { connected: boolean }> {
  ok: boolean
  error?: string
  messages?: EmailPanelMessage[]
  nextPageToken?: string
  settings?: TSettings
}

export function GoogleGmailFollowupPanel({ settings, todayTasks, disabled, onOpenSettings, onSettingsRefresh }: {
  settings: PublicGoogleGmailSettings | null
  todayTasks: PlanTask[]
  disabled: boolean
  onOpenSettings: () => void
  onSettingsRefresh: (settings: PublicGoogleGmailSettings) => void
}): React.JSX.Element {
  return (
    <EmailFollowupPanel
      provider="gmail"
      providerName="Gmail"
      settings={settings}
      todayTasks={todayTasks}
      disabled={disabled}
      onOpenSettings={onOpenSettings}
      onSettingsRefresh={onSettingsRefresh}
      searchMessages={async (query, pageToken) => {
        const result: GoogleGmailSearchResult = await window.assist.searchGoogleGmailMessages(query, pageToken)
        return {
          ok: result.ok,
          ...(result.error ? { error: result.error } : {}),
          ...(result.messages ? { messages: result.messages.map((message) => ({
            id: message.id,
            subject: message.subject,
            ...(message.from ? { sender: message.from } : {}),
            ...(message.date ? { receivedAt: message.date } : {}),
            ...(message.snippet ? { snippet: message.snippet } : {})
          })) } : {}),
          ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
          ...(result.settings ? { settings: result.settings } : {})
        }
      }}
    />
  )
}

export function OutlookMailFollowupPanel({ settings, todayTasks, disabled, onOpenSettings, onSettingsRefresh }: {
  settings: PublicMicrosoftMailSettings | null
  todayTasks: PlanTask[]
  disabled: boolean
  onOpenSettings: () => void
  onSettingsRefresh: (settings: PublicMicrosoftMailSettings) => void
}): React.JSX.Element {
  return (
    <EmailFollowupPanel
      provider="outlook"
      providerName="Outlook Mail"
      settings={settings}
      todayTasks={todayTasks}
      disabled={disabled}
      onOpenSettings={onOpenSettings}
      onSettingsRefresh={onSettingsRefresh}
      searchMessages={async (query, pageToken) => {
        const result: MicrosoftMailSearchResult = await window.assist.searchMicrosoftMail(query, pageToken)
        return {
          ok: result.ok,
          ...(result.error ? { error: result.error } : {}),
          ...(result.messages ? { messages: result.messages.map((message) => ({
            id: message.id,
            subject: message.subject,
            ...(message.from ? { sender: message.from } : {}),
            ...(message.receivedAt ? { receivedAt: message.receivedAt } : {})
          })) } : {}),
          ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
          ...(result.settings ? { settings: result.settings } : {})
        }
      }}
    />
  )
}

function EmailFollowupPanel<TSettings extends { connected: boolean }>({
  provider,
  providerName,
  settings,
  todayTasks,
  disabled,
  onOpenSettings,
  onSettingsRefresh,
  searchMessages
}: {
  provider: EmailTaskProvider
  providerName: string
  settings: TSettings | null
  todayTasks: PlanTask[]
  disabled: boolean
  onOpenSettings: () => void
  onSettingsRefresh: (settings: TSettings) => void
  searchMessages: (query: string, pageToken?: string) => Promise<EmailPanelReadResult<TSettings>>
}): React.JSX.Element {
  const [query, setQuery] = useState(provider === 'gmail' ? 'in:inbox' : '')
  const [activeQuery, setActiveQuery] = useState('')
  const [messages, setMessages] = useState<EmailPanelMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [nextPageToken, setNextPageToken] = useState<string | undefined>()
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [creatingMessageId, setCreatingMessageId] = useState('')
  const [createdMessageIds, setCreatedMessageIds] = useState<Set<string>>(() => new Set())
  const [taskError, setTaskError] = useState('')
  const [taskMessage, setTaskMessage] = useState('')
  const searchBusyRef = useRef(false)
  const createBusyRef = useRef(false)
  const requestVersion = useRef(0)
  const headingId = `${provider}-followup-title`

  useEffect(() => {
    if (settings?.connected) return
    requestVersion.current += 1
    setMessages([])
    setLoaded(false)
    setNextPageToken(undefined)
    setActiveQuery('')
    setSearchError('')
    setCreatedMessageIds(new Set())
    setTaskError('')
    setTaskMessage('')
  }, [settings?.connected])

  useEffect(() => () => { requestVersion.current += 1 }, [])

  const search = async (pageToken?: string): Promise<void> => {
    if (searchBusyRef.current) return
    const requestedQuery = pageToken ? activeQuery : query.trim()
    if (!requestedQuery) {
      setSearchError(`Enter a search phrase for ${providerName}.`)
      return
    }
    const version = ++requestVersion.current
    searchBusyRef.current = true
    setSearchBusy(true)
    setSearchError('')
    try {
      const result = await searchMessages(requestedQuery, pageToken)
      if (requestVersion.current !== version) return
      if (result.settings) onSettingsRefresh(result.settings)
      if (!result.ok || !result.messages) throw new Error(result.error ?? `Could not search ${providerName}.`)
      setActiveQuery(requestedQuery)
      setMessages((current) => pageToken ? appendUniqueMessages(current, result.messages!) : result.messages!)
      setLoaded(true)
      setNextPageToken(result.nextPageToken)
    } catch (cause) {
      if (requestVersion.current === version) setSearchError(errorText(cause, `Could not search ${providerName}.`))
    } finally {
      searchBusyRef.current = false
      if (requestVersion.current === version) setSearchBusy(false)
    }
  }

  const createFollowup = async (message: EmailPanelMessage): Promise<void> => {
    if (createBusyRef.current) return
    createBusyRef.current = true
    setCreatingMessageId(message.id)
    setTaskError('')
    setTaskMessage('')
    const input: EmailFollowupTaskInput = {
      provider,
      messageId: message.id,
      title: `Follow up: ${message.subject.trim() || '(no subject)'}`.slice(0, 240)
    }
    try {
      const result = await window.assist.createEmailFollowupTask(input)
      if (!result.ok) throw new Error(result.error ?? 'Could not create a follow-up task.')
      const output = result.output !== null && typeof result.output === 'object' ? result.output as { status?: unknown; task?: { title?: unknown } } : undefined
      setCreatedMessageIds((current) => new Set(current).add(message.id))
      setTaskMessage(output?.status === 'already_exists'
        ? 'A local task from this message already exists.'
        : `Follow-up task created${typeof output?.task?.title === 'string' ? `: ${output.task.title}` : ''}.`)
    } catch (cause) {
      setTaskError(errorText(cause, 'Could not create a follow-up task.'))
    } finally {
      createBusyRef.current = false
      setCreatingMessageId('')
    }
  }

  return (
    <section className="today-card today-email-panel" aria-labelledby={headingId}>
      <div className="today-card-head">
        <h3 id={headingId}>{providerName} follow-ups</h3>
        {settings?.connected && loaded && <span>{messages.length} messages</span>}
      </div>
      <p className="today-email-note">Each search page and local task asks for approval. The task stores only the message ID and a title based on its subject; email text is not copied into task notes or chat history.</p>
      {settings === null ? (
        <p className="muted" role="status">Checking {providerName} connection…</p>
      ) : !settings.connected ? (
        <div className="today-google-tasks-empty">
          <p>Connect {providerName} to search messages and add local follow-up tasks.</p>
          <button className="ghost-button" type="button" onClick={onOpenSettings} disabled={disabled}>Open Settings</button>
        </div>
      ) : (
        <>
          <form className="today-email-search" onSubmit={(event) => { event.preventDefault(); void search() }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={provider === 'gmail' ? 'Gmail search (for example, in:inbox newer_than:7d)' : 'Search phrase or subject'}
              aria-label={`${providerName} search query`}
              maxLength={provider === 'gmail' ? 500 : 200}
            />
            <button className="ghost-button" type="submit" disabled={disabled || searchBusy}>
              {searchBusy ? 'Waiting…' : loaded ? 'Search again' : 'Search'}
            </button>
          </form>
          {messages.length > 0 ? (
            <div className="today-email-list">
              {messages.map((message) => (
                <article className="today-email-message" key={message.id}>
                  <div className="today-email-copy">
                    <strong>{message.subject || '(No subject)'}</strong>
                    {message.sender && <span>From {message.sender}</span>}
                    {message.receivedAt && <time>{formatReceivedAt(message.receivedAt)}</time>}
                    {message.snippet && <p>{message.snippet}</p>}
                  </div>
                  {todayTasks.some((task) => task.emailSource?.provider === provider && task.emailSource.messageId === message.id) || createdMessageIds.has(message.id) ? (
                    <span className="today-calendar-prep-done">Follow-up added</span>
                  ) : (
                    <button className="ghost-button" type="button" aria-label={`Create follow-up task from ${message.subject || 'email'}`} onClick={() => void createFollowup(message)} disabled={disabled || Boolean(creatingMessageId)}>
                      {creatingMessageId === message.id ? 'Waiting for approval…' : 'Create follow-up'}
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : loaded ? (
            <p className="muted">No {providerName} messages matched this search.</p>
          ) : null}
          {nextPageToken && <button className="ghost-button" type="button" onClick={() => void search(nextPageToken)} disabled={disabled || searchBusy}>Load more messages</button>}
          {searchError && <p className="status-error" role="alert">{searchError}</p>}
          {taskMessage && <p className="status-success today-calendar-prep-status" role="status">{taskMessage}</p>}
          {taskError && <p className="status-error today-calendar-prep-status" role="alert">{taskError}</p>}
        </>
      )}
    </section>
  )
}

function appendUniqueMessages(current: EmailPanelMessage[], added: EmailPanelMessage[]): EmailPanelMessage[] {
  const seen = new Set(current.map((message) => message.id))
  return [...current, ...added.filter((message) => !seen.has(message.id))]
}

function formatReceivedAt(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : value
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === 'string' && error ? error : fallback
}
