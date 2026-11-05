import { useEffect, useRef, useState } from 'react'
import type { MicrosoftCalendarEvent } from '../../../shared/types'
import type { PublicMicrosoftCalendarSettings } from '../../../shared/ipc'

export function MicrosoftCalendarPanel({ settings, disabled, onOpenSettings, onSettingsRefresh }: {
  settings: PublicMicrosoftCalendarSettings | null
  disabled: boolean
  onOpenSettings: () => void
  onSettingsRefresh: (settings: PublicMicrosoftCalendarSettings) => void
}): React.JSX.Element {
  const [events, setEvents] = useState<MicrosoftCalendarEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [nextPageToken, setNextPageToken] = useState<string | undefined>()
  const [range, setRange] = useState<{ startDateTime: string; endDateTime: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const requestVersion = useRef(0)

  useEffect(() => {
    if (settings?.connected) return
    requestVersion.current += 1
    setEvents([])
    setLoaded(false)
    setNextPageToken(undefined)
    setRange(null)
    setError('')
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
      const result = await window.assist.listMicrosoftCalendarEvents(
        requestedRange.startDateTime,
        requestedRange.endDateTime,
        pageToken
      )
      if (requestVersion.current !== version) return
      if (result.settings) onSettingsRefresh(result.settings)
      if (!result.ok || !result.events) throw new Error(result.error ?? 'Could not load Outlook Calendar events.')
      setRange(requestedRange)
      setEvents((current) => pageToken ? [...current, ...result.events!] : result.events!)
      setLoaded(true)
      setNextPageToken(result.nextPageToken)
    } catch (cause) {
      if (requestVersion.current === version) setError(errorText(cause, 'Could not load Outlook Calendar events.'))
    } finally {
      busyRef.current = false
      if (requestVersion.current === version) setBusy(false)
    }
  }

  return (
    <section className="today-card today-google-tasks" aria-labelledby="microsoft-calendar-title">
      <div className="today-card-head">
        <h3 id="microsoft-calendar-title">Outlook Calendar</h3>
        {settings?.connected && events.length > 0 && <span>{events.length} events</span>}
      </div>
      <p className="today-google-tasks-note">Read-only connection. Loading each event page asks for approval. Chat may send approved event details to your configured model provider.</p>
      {settings === null ? (
        <p className="muted" role="status">Checking Outlook Calendar connection…</p>
      ) : !settings.connected ? (
        <div className="today-google-tasks-empty">
          <p>Connect Outlook Calendar to see today’s events beside your local tasks.</p>
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
                  {event.showAs && <span className="today-google-task-status">{formatShowAs(event.showAs)}</span>}
                </article>
              ))}
            </div>
          ) : loaded ? (
            <p className="muted">No Outlook Calendar events were found for today.</p>
          ) : null}
          {nextPageToken && <button className="ghost-button" type="button" onClick={() => void load(nextPageToken)} disabled={disabled || busy}>Load more events</button>}
          {error && <p className="status-error" role="alert">{error}</p>}
        </>
      )}
    </section>
  )
}

function localTodayRange(): { startDateTime: string; endDateTime: string } {
  const now = new Date()
  return {
    startDateTime: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
    endDateTime: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
  }
}

function formatEventTime(event: MicrosoftCalendarEvent): string {
  const start = new Date(event.start)
  const end = new Date(event.end)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return `${event.start} – ${event.end}`
  if (event.isAllDay) return `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(start)} · All day`
  const startLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(start)
  const sameLocalDay = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate()
  const endLabel = new Intl.DateTimeFormat(undefined, sameLocalDay ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }).format(end)
  return `${startLabel} – ${endLabel}`
}

function formatShowAs(value: NonNullable<MicrosoftCalendarEvent['showAs']>): string {
  switch (value) {
    case 'oof': return 'Out of office'
    case 'workingElsewhere': return 'Working elsewhere'
    case 'tentative': return 'Tentative'
    case 'busy': return 'Busy'
    case 'free': return 'Free'
    default: return 'Unknown availability'
  }
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === 'string' && error ? error : fallback
}
