import { useEffect, useRef, useState } from 'react'
import type { CalendarTaskProvider, PlanTask } from '../../../shared/types'
import type { CalendarPrepTaskInput, TodayTaskExportActionResult } from '../../../shared/ipc'

export interface CalendarPanelEvent {
  id: string
  title: string
  start: string
  end: string
  isAllDay: boolean
  location?: string
  statusLabel?: string
}

export interface CalendarPanelReadResult<TSettings extends { connected: boolean }> {
  ok: boolean
  error?: string
  events?: CalendarPanelEvent[]
  nextPageToken?: string
  settings?: TSettings
}

export function CalendarEventsPanel<TSettings extends { connected: boolean }>({
  provider,
  providerName,
  settings,
  todayTasks,
  disabled,
  onOpenSettings,
  onSettingsRefresh,
  listEvents
}: {
  provider: CalendarTaskProvider
  providerName: string
  settings: TSettings | null
  todayTasks: PlanTask[]
  disabled: boolean
  onOpenSettings: () => void
  onSettingsRefresh: (settings: TSettings) => void
  listEvents: (start: string, end: string, pageToken?: string) => Promise<CalendarPanelReadResult<TSettings>>
}): React.JSX.Element {
  const [events, setEvents] = useState<CalendarPanelEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [nextPageToken, setNextPageToken] = useState<string | undefined>()
  const [range, setRange] = useState<{ start: string; end: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [creatingEventId, setCreatingEventId] = useState('')
  const [createdEventIds, setCreatedEventIds] = useState<Set<string>>(() => new Set())
  const [prepError, setPrepError] = useState('')
  const [prepMessage, setPrepMessage] = useState('')
  const busyRef = useRef(false)
  const prepBusyRef = useRef(false)
  const requestVersion = useRef(0)
  const headingId = `${provider}-calendar-title`

  useEffect(() => {
    if (settings?.connected) return
    requestVersion.current += 1
    setEvents([])
    setLoaded(false)
    setNextPageToken(undefined)
    setRange(null)
    setError('')
    setCreatedEventIds(new Set())
    setPrepError('')
    setPrepMessage('')
  }, [settings?.connected])

  useEffect(() => () => { requestVersion.current += 1 }, [])

  const load = async (pageToken?: string): Promise<void> => {
    if (busyRef.current) return
    const requestedRange = pageToken ? range : localTodayRange()
    if (!requestedRange) return
    const version = requestVersion.current
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const result = await listEvents(requestedRange.start, requestedRange.end, pageToken)
      if (requestVersion.current !== version) return
      if (result.settings) onSettingsRefresh(result.settings)
      if (!result.ok || !result.events) throw new Error(result.error ?? `Could not load ${providerName} events.`)
      setRange(requestedRange)
      setEvents((current) => pageToken ? appendUniqueEvents(current, result.events!) : result.events!)
      setLoaded(true)
      setNextPageToken(result.nextPageToken)
    } catch (cause) {
      if (requestVersion.current === version) setError(errorText(cause, `Could not load ${providerName} events.`))
    } finally {
      busyRef.current = false
      if (requestVersion.current === version) setBusy(false)
    }
  }

  const createPrepTask = async (event: CalendarPanelEvent): Promise<void> => {
    if (prepBusyRef.current) return
    prepBusyRef.current = true
    setCreatingEventId(event.id)
    setPrepError('')
    setPrepMessage('')
    const input: CalendarPrepTaskInput = {
      provider,
      eventId: event.id,
      eventTitle: event.title,
      start: event.start,
      end: event.end,
      isAllDay: event.isAllDay,
      ...(event.location ? { location: event.location } : {})
    }
    try {
      const result: TodayTaskExportActionResult = await window.assist.createCalendarPrepTask(input)
      if (!result.ok) throw new Error(result.error ?? 'Could not create a prep task from this event.')
      const output = result.output !== null && typeof result.output === 'object' ? result.output as { status?: unknown; title?: unknown } : undefined
      setCreatedEventIds((current) => new Set(current).add(event.id))
      setPrepMessage(output?.status === 'already_exists'
        ? 'A local task from this event already exists.'
        : `Prep task created${typeof output?.title === 'string' ? `: ${output.title}` : ''}.`)
    } catch (cause) {
      setPrepError(errorText(cause, 'Could not create a prep task from this event.'))
    } finally {
      prepBusyRef.current = false
      setCreatingEventId('')
    }
  }

  return (
    <section className="today-card today-google-tasks" aria-labelledby={headingId}>
      <div className="today-card-head">
        <h3 id={headingId}>{providerName}</h3>
        {settings?.connected && events.length > 0 && <span>{events.length} events</span>}
      </div>
      <p className="today-google-tasks-note">Loading each event page asks for approval. Create a local prep task from a selected event with its own approval; the calendar stays unchanged. Chat may send approved event details to your configured model provider.</p>
      {settings === null ? (
        <p className="muted" role="status">Checking {providerName} connection…</p>
      ) : !settings.connected ? (
        <div className="today-google-tasks-empty">
          <p>Connect {providerName} to see today’s events beside your local tasks.</p>
          <button className="ghost-button" type="button" onClick={onOpenSettings} disabled={disabled}>Open Settings</button>
        </div>
      ) : (
        <>
          <div className="today-google-tasks-controls">
            <button className="ghost-button" type="button" onClick={() => void load()} disabled={disabled || busy}>
              {busy ? 'Waiting…' : loaded ? 'Refresh today’s events' : 'Load today’s events'}
            </button>
          </div>
          {events.length > 0 ? (
            <div className="today-google-task-list">
              {events.map((event) => (
                <article className="today-google-task" key={event.id}>
                  <div className="today-google-task-copy">
                    <strong>{event.title}</strong>
                    <span>{formatEventTime(event)}</span>
                    {event.location && <span>{event.location}</span>}
                  </div>
                  <div className="today-calendar-event-actions">
                    {event.statusLabel && <span className="today-google-task-status">{event.statusLabel}</span>}
                    {todayTasks.some((task) => task.calendarSource?.provider === provider && task.calendarSource.eventId === event.id) || createdEventIds.has(event.id) ? (
                      <span className="today-calendar-prep-done">Prep task added</span>
                    ) : (
                      <button className="ghost-button" type="button" aria-label={`Create a prep task from ${event.title}`} onClick={() => void createPrepTask(event)} disabled={disabled || Boolean(creatingEventId)}>
                        {creatingEventId === event.id ? 'Waiting for approval…' : 'Create prep task'}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : loaded ? (
            <p className="muted">No {providerName} events were found for today.</p>
          ) : null}
          {nextPageToken && <button className="ghost-button" type="button" onClick={() => void load(nextPageToken)} disabled={disabled || busy}>Load more events</button>}
          {error && <p className="status-error" role="alert">{error}</p>}
          {prepMessage && <p className="status-success today-calendar-prep-status" role="status">{prepMessage}</p>}
          {prepError && <p className="status-error today-calendar-prep-status" role="alert">{prepError}</p>}
        </>
      )}
    </section>
  )
}

function appendUniqueEvents(current: CalendarPanelEvent[], added: CalendarPanelEvent[]): CalendarPanelEvent[] {
  const seen = new Set(current.map((event) => event.id))
  return [...current, ...added.filter((event) => !seen.has(event.id))]
}

function localTodayRange(): { start: string; end: string } {
  const now = new Date()
  return {
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
  }
}

function formatEventTime(event: CalendarPanelEvent): string {
  const start = new Date(event.start)
  const end = new Date(event.end)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return `${event.start} – ${event.end}`
  if (event.isAllDay) return `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(start)} · All day`
  const startLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(start)
  const sameLocalDay = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate()
  const endLabel = new Intl.DateTimeFormat(undefined, sameLocalDay ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }).format(end)
  return `${startLabel} – ${endLabel}`
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === 'string' && error ? error : fallback
}
