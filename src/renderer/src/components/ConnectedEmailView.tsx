import { useEffect, useState } from 'react'
import type { PlanTask } from '../../../shared/types'
import type { PublicGoogleGmailSettings, PublicMicrosoftMailSettings } from '../../../shared/ipc'
import { GoogleGmailFollowupPanel, OutlookMailFollowupPanel } from './EmailFollowupPanel'

export function ConnectedEmailView({
  googleGmailSettings,
  microsoftMailSettings,
  disabled,
  onOpenSettings,
  onGoogleGmailSettingsRefresh,
  onMicrosoftMailSettingsRefresh
}: {
  googleGmailSettings: PublicGoogleGmailSettings | null
  microsoftMailSettings: PublicMicrosoftMailSettings | null
  disabled: boolean
  onOpenSettings: () => void
  onGoogleGmailSettingsRefresh: (settings: PublicGoogleGmailSettings) => void
  onMicrosoftMailSettingsRefresh: (settings: PublicMicrosoftMailSettings) => void
}): React.JSX.Element {
  const [tasks, setTasks] = useState<PlanTask[]>([])
  const [tasksError, setTasksError] = useState('')

  useEffect(() => {
    let active = true
    let requestVersion = 0
    const loadTasks = (): void => {
      const version = ++requestVersion
      setTasksError('')
      void window.assist.getPlanTasks(false).then((value) => {
        if (active && version === requestVersion) setTasks(value)
      }).catch((error: unknown) => {
        if (active && version === requestVersion) setTasksError(error instanceof Error ? error.message : String(error))
      })
    }
    loadTasks()
    const unsubscribe = window.assist.onEvent((event) => {
      if (event.type === 'today_changed') loadTasks()
    })
    return () => { active = false; requestVersion += 1; unsubscribe() }
  }, [])

  return (
    <div className="email-search-view">
      <header className="email-search-header">
        <div>
          <span className="eyebrow">Connected accounts</span>
          <h2>Email</h2>
          <p>Search Gmail or Outlook when you choose. Each search page and follow-up task asks for approval.</p>
        </div>
        <div className="email-search-boundary" role="note">
          <strong>Private by default</strong>
          <span>Results stay in this view. Follow-up tasks keep the message ID and a subject-based title, not the email body or snippet.</span>
        </div>
      </header>
      {tasksError && <p className="email-search-task-warning" role="status">Could not check existing follow-up tasks. The app still checks for duplicates when you create one.</p>}
      <div className="email-search-grid">
        <GoogleGmailFollowupPanel
          settings={googleGmailSettings}
          todayTasks={tasks}
          disabled={disabled}
          onOpenSettings={onOpenSettings}
          onSettingsRefresh={onGoogleGmailSettingsRefresh}
        />
        <OutlookMailFollowupPanel
          settings={microsoftMailSettings}
          todayTasks={tasks}
          disabled={disabled}
          onOpenSettings={onOpenSettings}
          onSettingsRefresh={onMicrosoftMailSettingsRefresh}
        />
      </div>
    </div>
  )
}
