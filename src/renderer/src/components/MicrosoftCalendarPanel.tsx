import type { PublicMicrosoftCalendarSettings } from '../../../shared/ipc'
import type { PlanTask } from '../../../shared/types'
import { CalendarEventsPanel } from './CalendarEventsPanel'

export function MicrosoftCalendarPanel({ settings, todayTasks, disabled, onOpenSettings, onPrepareMeeting, onSettingsRefresh }: {
  settings: PublicMicrosoftCalendarSettings | null
  todayTasks: PlanTask[]
  disabled: boolean
  onOpenSettings: () => void
  onPrepareMeeting: (prompt: string) => void
  onSettingsRefresh: (settings: PublicMicrosoftCalendarSettings) => void
}): React.JSX.Element {
  return (
    <CalendarEventsPanel
      provider="microsoft_calendar"
      providerName="Outlook Calendar"
      settings={settings}
      todayTasks={todayTasks}
      disabled={disabled}
      onOpenSettings={onOpenSettings}
      onPrepareMeeting={onPrepareMeeting}
      onSettingsRefresh={onSettingsRefresh}
      listEvents={async (start, end, pageToken) => {
        const result = await window.assist.listMicrosoftCalendarEvents(start, end, pageToken)
        return {
          ok: result.ok,
          ...(result.error ? { error: result.error } : {}),
          ...(result.events ? { events: result.events.map((event) => ({
            id: event.id,
            title: event.title,
            start: event.start,
            end: event.end,
            isAllDay: event.isAllDay,
            ...(event.location ? { location: event.location } : {}),
            ...(event.showAs ? { statusLabel: formatShowAs(event.showAs) } : {})
          })) } : {}),
          ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
          ...(result.settings ? { settings: result.settings } : {})
        }
      }}
    />
  )
}

function formatShowAs(value: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown'): string {
  switch (value) {
    case 'oof': return 'Out of office'
    case 'workingElsewhere': return 'Working elsewhere'
    case 'tentative': return 'Tentative'
    case 'busy': return 'Busy'
    case 'free': return 'Free'
    default: return 'Availability unknown'
  }
}
