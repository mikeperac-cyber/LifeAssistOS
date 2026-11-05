import type { PublicGoogleCalendarSettings } from '../../../shared/ipc'
import type { PlanTask } from '../../../shared/types'
import { CalendarEventsPanel } from './CalendarEventsPanel'

export function GoogleCalendarPanel({ settings, todayTasks, disabled, onOpenSettings, onSettingsRefresh }: {
  settings: PublicGoogleCalendarSettings | null
  todayTasks: PlanTask[]
  disabled: boolean
  onOpenSettings: () => void
  onSettingsRefresh: (settings: PublicGoogleCalendarSettings) => void
}): React.JSX.Element {
  return (
    <CalendarEventsPanel
      provider="google_calendar"
      providerName="Google Calendar"
      settings={settings}
      todayTasks={todayTasks}
      disabled={disabled}
      onOpenSettings={onOpenSettings}
      onSettingsRefresh={onSettingsRefresh}
      listEvents={async (start, end, pageToken) => {
        const result = await window.assist.listGoogleCalendarEvents(start, end, pageToken)
        return {
          ok: result.ok,
          ...(result.error ? { error: result.error } : {}),
          ...(result.events ? { events: result.events.map((event) => ({
            id: event.id,
            title: event.summary,
            start: event.startsAt,
            end: event.endsAt,
            isAllDay: event.isAllDay,
            ...(event.location ? { location: event.location } : {})
          })) } : {}),
          ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
          ...(result.settings ? { settings: result.settings } : {})
        }
      }}
    />
  )
}
