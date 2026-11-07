import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { MAX_CHAT_MESSAGE_CHARS } from '../../shared/types'
import type {
  AuditEvent,
  AuditIntegrity,
  ApprovalChoice,
  ChatMessage,
  ChatImageAttachmentInput,
  ChatEffort,
  ChatMode,
  FinanceReport,
  FinanceTransactionInput,
  MemoryScope,
  WorkflowRecord,
  WorkflowStep,
  ScheduledAgentTask,
  ScheduledTaskSchedule,
  AssistantSkill,
  AssistantSkillInput,
  FolderGrant,
  PermissionRequest,
  ProviderStatus,
  MemoryFact,
  VaultDocument
} from '../../shared/types'
import type { CoachArea } from '../../shared/types'
import type { TeachingPack } from '../../shared/teaching'
import type {
  GrantMutationResult,
  AuditExportResult,
  BackupResult,
  SpeechResult,
  DomainMutationResult,
  WorkflowMutationResult,
  WorkflowRunResult,
  ScheduledTaskMutationResult,
  ScheduledTaskRunResult,
  SkillMutationResult,
  PublicSettings,
  LocalApiResult,
  LocalApiStatus,
  PublicWebSearchSettings,
  PublicNotionSettings,
  PublicGitHubSettings,
  PublicGoogleCalendarSettings,
  PublicGoogleGmailSettings,
  PublicGoogleDriveSettings,
  PublicGoogleTasksSettings,
  PublicMicrosoftTodoSettings,
  PublicMicrosoftCalendarSettings,
  PublicMicrosoftMailSettings,
  PublicMicrosoftOneDriveSettings,
  SettingsPatch,
  SettingsResult,
  WebSearchSettingsResult,
  NotionSettingsResult,
  GitHubSettingsResult,
  GoogleCalendarSettingsResult,
  GoogleGmailSettingsResult,
  GoogleDriveSettingsResult,
  GoogleTasksSettingsResult,
  MicrosoftTodoSettingsResult,
  MicrosoftTodoConnectStatusResult,
  MicrosoftCalendarSettingsResult,
  MicrosoftCalendarConnectStatusResult,
  MicrosoftMailSettingsResult,
  MicrosoftMailConnectStatusResult,
  MicrosoftOneDriveSettingsResult,
  MicrosoftOneDriveConnectStatusResult
} from '../../shared/ipc'
import { presetFor } from '../../shared/presets'
import { buildWorkflowDraftFromTurn } from '../../shared/workflow-params'
import { speakWithLocalVoice } from './local-speech'
import { AccessibleDialog } from './components/AccessibleDialog'
import { ApprovalModal } from './components/ApprovalModal'
import { ChatView } from './components/ChatView'
import { Sidebar } from './components/Sidebar'
import { readSidebarVisibility, resolveIntegrationTargetView, resolveSettingsSection, shouldHandleNavigationShortcut, shouldHandleQuickCaptureShortcut, SIDEBAR_VISIBILITY_STORAGE_KEY, VIEW_META, type SettingsSection, type SidebarVisibility, type View } from './navigation'
import type { GlobalSearchSelection, TodaySearchTarget } from './global-search'
import { applyAppTheme, getSavedAppTheme, APP_THEME_STORAGE_KEY, type AppTheme } from './theme'
import { statusFor, type TimelineItem } from './types'

const ActivityView = lazy(() => import('./components/ActivityView').then((module) => ({ default: module.ActivityView })))
const FinanceView = lazy(() => import('./components/FinanceView').then((module) => ({ default: module.FinanceView })))
const WorkView = lazy(() => import('./components/WorkView').then((module) => ({ default: module.WorkView })))
const WorkflowsView = lazy(() => import('./components/WorkflowsView').then((module) => ({ default: module.WorkflowsView })))
const ScheduledTasksView = lazy(() => import('./components/ScheduledTasksView').then((module) => ({ default: module.ScheduledTasksView })))
const SkillsView = lazy(() => import('./components/SkillsView').then((module) => ({ default: module.SkillsView })))
const SettingsView = lazy(() => import('./components/SettingsView').then((module) => ({ default: module.SettingsView })))
const ResearchView = lazy(() => import('./components/ResearchView').then((module) => ({ default: module.ResearchView })))
const VaultView = lazy(() => import('./components/VaultView').then((module) => ({ default: module.VaultView })))
const TodayView = lazy(() => import('./components/TodayView').then((module) => ({ default: module.TodayView })))
const TeachingView = lazy(() => import('./components/TeachingView').then((module) => ({ default: module.TeachingView })))
const CoachView = lazy(() => import('./components/CoachView').then((module) => ({ default: module.CoachView })))
const IntegrationsView = lazy(() => import('./components/IntegrationsView').then((module) => ({ default: module.IntegrationsView })))
const ConnectedEmailView = lazy(() => import('./components/ConnectedEmailView').then((module) => ({ default: module.ConnectedEmailView })))
const ConnectedFilesView = lazy(() => import('./components/ConnectedFilesView').then((module) => ({ default: module.ConnectedFilesView })))
const QuickCaptureDialog = lazy(() => import('./components/QuickCaptureDialog').then((module) => ({ default: module.QuickCaptureDialog })))
const GlobalSearchDialog = lazy(() => import('./components/GlobalSearchDialog').then((module) => ({ default: module.GlobalSearchDialog })))

type StartupLoadKey =
  | 'audit'
  | 'auditIntegrity'
  | 'chat'
  | 'grants'
  | 'domains'
  | 'settings'
  | 'localApi'
  | 'webSearch'
  | 'notion'
  | 'github'
  | 'calendar'
  | 'gmail'
  | 'drive'
  | 'tasks'
  | 'microsoftTodo'
  | 'microsoftCalendar'
  | 'microsoftMail'
  | 'microsoftOneDrive'
  | 'speech'
  | 'workflows'
  | 'scheduledTasks'
  | 'skills'

type StartupLoadState = { status: 'loading' | 'loaded' | 'error'; error?: string }

const STARTUP_LOAD_LABELS: Record<StartupLoadKey, string> = {
  audit: 'Activity log',
  auditIntegrity: 'Activity log integrity',
  chat: 'Chat history',
  grants: 'Approved folders',
  domains: 'Allowed domains',
  settings: 'Settings',
  localApi: 'Local API status',
  webSearch: 'Web search settings',
  notion: 'Notion settings',
  github: 'GitHub settings',
  calendar: 'Google Calendar settings',
  gmail: 'Gmail settings',
  drive: 'Google Drive settings',
  tasks: 'Google Tasks settings',
  microsoftTodo: 'Microsoft To Do settings',
  microsoftCalendar: 'Outlook Calendar settings',
  microsoftMail: 'Outlook Mail settings',
  microsoftOneDrive: 'OneDrive settings',
  speech: 'Speech settings',
  workflows: 'Workflows',
  scheduledTasks: 'Scheduled tasks',
  skills: 'Skills'
}

const SETTINGS_STARTUP_KEYS: StartupLoadKey[] = [
  'settings', 'grants', 'domains', 'localApi', 'webSearch', 'notion', 'github', 'calendar', 'gmail', 'drive', 'tasks', 'microsoftTodo', 'microsoftCalendar', 'microsoftMail', 'microsoftOneDrive', 'speech'
]

const CHAT_STARTUP_KEYS: StartupLoadKey[] = [
  'chat', 'settings', 'workflows', 'scheduledTasks', 'skills', 'speech'
]

const ACTIVITY_STARTUP_KEYS: StartupLoadKey[] = ['audit', 'auditIntegrity']
const INTEGRATION_STARTUP_KEYS: StartupLoadKey[] = ['calendar', 'gmail', 'drive', 'tasks', 'microsoftTodo', 'microsoftCalendar', 'microsoftMail', 'microsoftOneDrive', 'notion', 'github']
const EMAIL_STARTUP_KEYS: StartupLoadKey[] = ['gmail', 'microsoftMail']

let localSequence = 0

function localId(): string {
  localSequence += 1
  return `local-${Date.now()}-${localSequence}`
}

function systemMessage(text: string): ChatMessage {
  return { id: localId(), role: 'system', text, at: new Date().toISOString() }
}

function StartupLoadNotice({
  label,
  loading,
  error,
  onRetry
}: {
  label: string
  loading: boolean
  error: string
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div className={`startup-load-notice ${loading ? 'is-loading' : 'has-error'}`}>
      <p role={loading ? 'status' : 'alert'}>
        {loading ? `Loading ${label}…` : error || `Could not load ${label}.`}
      </p>
      {!loading && <button className="ghost-button" type="button" onClick={onRetry}>Retry</button>}
    </div>
  )
}

function upsertMessage(items: TimelineItem[], message: ChatMessage): TimelineItem[] {
  const index = items.findIndex(
    (item) => item.kind === 'message' && item.message.id === message.id
  )

  if (index === -1) {
    return [...items, { kind: 'message', message }]
  }

  const next = [...items]
  next[index] = { kind: 'message', message }
  return next
}

function timelineFor(messages: ChatMessage[]): TimelineItem[] {
  return messages.map((message) => ({ kind: 'message', message }))
}

function workflowDraftFor(items: TimelineItem[]): { prompt: string; steps: WorkflowStep[] } | null {
  let userIndex = -1
  let prompt = ''
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind === 'message' && item.message.role === 'user') {
      userIndex = index
      prompt = item.message.text
      break
    }
  }
  if (userIndex < 0) return null
  const toolItems = items.slice(userIndex + 1).filter((item): item is Extract<TimelineItem, { kind: 'tool' }> => item.kind === 'tool')
  if (toolItems.length === 0) return null

  return buildWorkflowDraftFromTurn(
    prompt,
    toolItems.map((item) => ({
      name: item.call.name,
      args: item.call.args,
      summary: item.call.summary ?? item.call.name,
      ok: item.status === 'success' && Boolean(item.result?.ok)
    }))
  )
}

export default function App(): React.JSX.Element {
  const [view, setView] = useState<View>('chat')
  const [sidebarVisibility, setSidebarVisibility] = useState<SidebarVisibility>(() =>
    readSidebarVisibility((key) => window.localStorage.getItem(key))
  )
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const navigateToView = useCallback((nextView: View): void => {
    if (nextView === 'settings') setSettingsSection('general')
    setView(nextView)
  }, [])
  const openMemorySettings = useCallback((): void => {
    setSettingsSection(resolveSettingsSection('memory'))
    setView('settings')
  }, [])
  const toggleSidebar = useCallback((): void => {
    setSidebarVisibility((current) => current === 'open' ? 'closed' : 'open')
  }, [])
  const [appTheme, setAppTheme] = useState<AppTheme>(getSavedAppTheme)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [auditIntegrity, setAuditIntegrity] = useState<AuditIntegrity>({
    valid: true,
    legacyEvents: 0,
    chainedEvents: 0
  })
  const [permission, setPermission] = useState<PermissionRequest | null>(null)
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [todaySearchTarget, setTodaySearchTarget] = useState<TodaySearchTarget | null>(null)
  const [pendingVaultDocument, setPendingVaultDocument] = useState<VaultDocument | null>(null)
  const [selectedMemoryResult, setSelectedMemoryResult] = useState<{ fact: MemoryFact; query: string } | null>(null)
  const [workflowSearchTarget, setWorkflowSearchTarget] = useState<string | null>(null)
  const [scheduledSearchTarget, setScheduledSearchTarget] = useState<string | null>(null)
  const [skillSearchTarget, setSkillSearchTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [appWarning, setAppWarning] = useState('')
  const [startupLoads, setStartupLoads] = useState<Partial<Record<StartupLoadKey, StartupLoadState>>>({})
  const [step, setStep] = useState<{ index: number; max: number } | null>(null)
  const [grants, setGrants] = useState<FolderGrant[]>([])
  const [allowedDomains, setAllowedDomains] = useState<string[]>([])
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [localApiStatus, setLocalApiStatus] = useState<LocalApiStatus | null>(null)
  const [localApiActivity, setLocalApiActivity] = useState<{ summary?: string } | null>(null)
  const [webSearchSettings, setWebSearchSettings] = useState<PublicWebSearchSettings | null>(null)
  const [notionSettings, setNotionSettings] = useState<PublicNotionSettings | null>(null)
  const [githubSettings, setGitHubSettings] = useState<PublicGitHubSettings | null>(null)
  const [googleCalendarSettings, setGoogleCalendarSettings] = useState<PublicGoogleCalendarSettings | null>(null)
  const [googleGmailSettings, setGoogleGmailSettings] = useState<PublicGoogleGmailSettings | null>(null)
  const [googleDriveSettings, setGoogleDriveSettings] = useState<PublicGoogleDriveSettings | null>(null)
  const [googleTasksSettings, setGoogleTasksSettings] = useState<PublicGoogleTasksSettings | null>(null)
  const [microsoftTodoSettings, setMicrosoftTodoSettings] = useState<PublicMicrosoftTodoSettings | null>(null)
  const [microsoftCalendarSettings, setMicrosoftCalendarSettings] = useState<PublicMicrosoftCalendarSettings | null>(null)
  const [microsoftMailSettings, setMicrosoftMailSettings] = useState<PublicMicrosoftMailSettings | null>(null)
  const [microsoftOneDriveSettings, setMicrosoftOneDriveSettings] = useState<PublicMicrosoftOneDriveSettings | null>(null)
  const [speechEndpoint, setSpeechEndpoint] = useState('')
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const onboardingTitleRef = useRef<HTMLHeadingElement>(null)
  const [voiceChatEnabled, setVoiceChatEnabled] = useState(() => {
    try {
      return localStorage.getItem('mike-assist-voice-chat') === 'enabled'
    } catch {
      return false
    }
  })
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; updatedAt: string }>>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [sessionSearch, setSessionSearch] = useState('')
  const [filteredSessions, setFilteredSessions] = useState<Array<{ id: string; title: string; updatedAt: string }> | null>(null)
  const [renamingSession, setRenamingSession] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [chatMode, setChatMode] = useState<ChatMode>(() => {
    try {
      const saved = localStorage.getItem('mike-assist-chat-mode')
      return saved === 'brainstorm' || saved === 'software' || saved === 'review' || saved === 'plan' || saved === 'build' || saved === 'goal' || saved === 'coach_personal' || saved === 'coach_business'
        ? saved
        : 'assistant'
    } catch {
      return 'assistant'
    }
  })
  const [chatEffort, setChatEffort] = useState<ChatEffort>(() => {
    try {
      const saved = localStorage.getItem('mike-assist-chat-effort')
      return saved === 'low' || saved === 'high' ? saved : 'medium'
    } catch {
      return 'medium'
    }
  })
  const [financePeriod, setFinancePeriod] = useState<'week' | 'month'>('month')
  const [financeReport, setFinanceReport] = useState<FinanceReport | null>(null)
  const [financeLoading, setFinanceLoading] = useState(true)
  const [financeError, setFinanceError] = useState('')
  const [financeEntryBusy, setFinanceEntryBusy] = useState(false)
  const [financeRefresh, setFinanceRefresh] = useState(0)
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([])
  const [skills, setSkills] = useState<AssistantSkill[]>([])
  const [workflowRunningId, setWorkflowRunningId] = useState<string | null>(null)
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledAgentTask[]>([])
  const [memoryVersion, setMemoryVersion] = useState(0)
  const [input, setInput] = useState('')
  const [queuedTasks, setQueuedTasks] = useState<string[]>([])
  const [queueRunning, setQueueRunning] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const streaming = useRef(new Map<string, string>())
  const startupReloaders = useRef(new Map<StartupLoadKey, () => void>())
  const busyRef = useRef(false)
  const queuedTasksRef = useRef<string[]>([])
  const queueRunningRef = useRef(false)
  const queueCompletionRef = useRef<(() => void) | null>(null)
  const directWorkflowRunningRef = useRef(false)
  const toolNamesByCallId = useRef(new Map<string, string>())
  const globalSearchSelectionRef = useRef(0)
  const previousViewRef = useRef(view)
  const voiceChatRef = useRef(voiceChatEnabled)
  const chatModeRef = useRef<ChatMode>(chatMode)
  const chatEffortRef = useRef<ChatEffort>(chatEffort)

  useEffect(() => {
    if (previousViewRef.current === 'vault' && view !== 'vault') {
      globalSearchSelectionRef.current += 1
      setPendingVaultDocument(null)
    }
    previousViewRef.current = view
  }, [view])

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      const focusIsProtected = target !== null && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog') !== null
      if (!shouldHandleNavigationShortcut(event, focusIsProtected)) return
      event.preventDefault()
      setGlobalSearchOpen(true)
    }
    window.addEventListener('keydown', handleGlobalSearchShortcut)
    return () => window.removeEventListener('keydown', handleGlobalSearchShortcut)
  }, [])

  useEffect(() => {
    applyAppTheme(document.documentElement, appTheme)
    try {
      localStorage.setItem(APP_THEME_STORAGE_KEY, appTheme)
    } catch {
      // The selected theme remains active for this renderer session.
    }
  }, [appTheme])

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_VISIBILITY_STORAGE_KEY, sidebarVisibility)
    } catch {
      // Keep the chosen layout for this renderer session.
    }
  }, [sidebarVisibility])

  useEffect(() => {
    const handleQuickCaptureShortcut = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      const focusIsProtected = target !== null && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog') !== null
      if (!shouldHandleQuickCaptureShortcut(event, focusIsProtected)) return
      event.preventDefault()
      setQuickCaptureOpen(true)
    }
    window.addEventListener('keydown', handleQuickCaptureShortcut)
    return () => window.removeEventListener('keydown', handleQuickCaptureShortcut)
  }, [])

  useEffect(() => {
    voiceChatRef.current = voiceChatEnabled
    try {
      localStorage.setItem('mike-assist-voice-chat', voiceChatEnabled ? 'enabled' : 'disabled')
    } catch {
      // Voice mode remains available for this renderer session.
    }
    if (!voiceChatEnabled && typeof window !== 'undefined') window.speechSynthesis?.cancel()
  }, [voiceChatEnabled])

  useEffect(() => {
    chatModeRef.current = chatMode
    try {
      localStorage.setItem('mike-assist-chat-mode', chatMode)
    } catch {
      // Mode selection remains available for this renderer session.
    }
  }, [chatMode])

  useEffect(() => {
    chatEffortRef.current = chatEffort
    try {
      localStorage.setItem('mike-assist-chat-effort', chatEffort)
    } catch {
      // Response effort remains available for this renderer session.
    }
  }, [chatEffort])

  useEffect(() => {
    let alive = true
    const loadFailures = new Map<StartupLoadKey, string>()
    const loadInitial = <T,>(key: StartupLoadKey, request: () => Promise<T>, apply: (value: T) => void): void => {
      const retry = (): void => {
        if (!alive) return
        setStartupLoads((current) => ({ ...current, [key]: { status: 'loading' } }))
        void Promise.resolve().then(request).then((value) => {
          if (!alive) return
          apply(value)
          setStartupLoads((current) => ({ ...current, [key]: { status: 'loaded' } }))
          loadFailures.delete(key)
          setAppWarning((current) => {
            if (!current.startsWith('Some app data could not be loaded:')) return current
            const remaining = [...loadFailures.values()]
            return remaining.length > 0 ? `Some app data could not be loaded: ${remaining.join('; ')}` : ''
          })
        }).catch((error: unknown) => {
          if (!alive) return
          const detail = error instanceof Error ? error.message : String(error)
          const failure = `${STARTUP_LOAD_LABELS[key]}: ${detail}`
          loadFailures.set(key, failure)
          setStartupLoads((current) => ({ ...current, [key]: { status: 'error', error: detail } }))
          setAppWarning(`Some app data could not be loaded: ${[...loadFailures.values()].join('; ')}`)
        })
      }
      startupReloaders.current.set(key, retry)
      retry()
    }

    loadInitial('audit', () => window.assist.getAudit(), (events) => {
      setAudit((current) => {
        const loadedIds = new Set(events.map((event) => event.id))
        return [...events, ...current.filter((event) => !loadedIds.has(event.id))]
      })
    })
    loadInitial('auditIntegrity', () => window.assist.getAuditIntegrity(), setAuditIntegrity)
    loadInitial('chat', () => window.assist.getChatState(), (result) => {
      if (!result.ok || !result.state) throw new Error(result.error ?? 'The chat store is not ready.')
      setSessions(result.state.sessions)
      setActiveSessionId(result.state.activeSessionId)
      setTimeline(timelineFor(result.state.messages))
    })
    loadInitial('grants', () => window.assist.getGrants(), setGrants)
    loadInitial('domains', () => window.assist.getAllowedDomains(), setAllowedDomains)
    loadInitial('settings', () => window.assist.getSettings(), (value) => {
      setSettings(value)
      setOnboardingOpen(!value.onboardingComplete)
    })
    loadInitial('localApi', () => window.assist.getLocalApiStatus(), setLocalApiStatus)
    loadInitial('webSearch', () => window.assist.getWebSearchSettings(), setWebSearchSettings)
    loadInitial('notion', () => window.assist.getNotionSettings(), setNotionSettings)
    loadInitial('github', () => window.assist.getGitHubSettings(), setGitHubSettings)
    loadInitial('calendar', () => window.assist.getGoogleCalendarSettings(), setGoogleCalendarSettings)
    loadInitial('gmail', () => window.assist.getGoogleGmailSettings(), setGoogleGmailSettings)
    loadInitial('drive', () => window.assist.getGoogleDriveSettings(), setGoogleDriveSettings)
    loadInitial('tasks', () => window.assist.getGoogleTasksSettings(), setGoogleTasksSettings)
    loadInitial('microsoftTodo', () => window.assist.getMicrosoftTodoSettings(), setMicrosoftTodoSettings)
    loadInitial('microsoftCalendar', () => window.assist.getMicrosoftCalendarSettings(), setMicrosoftCalendarSettings)
    loadInitial('microsoftMail', () => window.assist.getMicrosoftMailSettings(), setMicrosoftMailSettings)
    loadInitial('microsoftOneDrive', () => window.assist.getMicrosoftOneDriveSettings(), setMicrosoftOneDriveSettings)
    loadInitial('speech', () => window.assist.getSpeechEndpoint(), setSpeechEndpoint)
    loadInitial('workflows', () => window.assist.getWorkflows(), setWorkflows)
    loadInitial('scheduledTasks', () => window.assist.getScheduledTasks(), setScheduledTasks)
    loadInitial('skills', () => window.assist.getSkills(), setSkills)

    return () => {
      alive = false
      startupReloaders.current.clear()
    }
  }, [])

  useEffect(() => {
    return window.assist.onEvent((event) => {
      switch (event.type) {
        case 'user_message':
          setTimeline((previous) => [...previous, { kind: 'message', message: event.message }])
          break

        case 'assistant_delta': {
          const text = (streaming.current.get(event.id) ?? '') + event.text
          streaming.current.set(event.id, text)
          setTimeline((previous) =>
            upsertMessage(previous, {
              id: event.id,
              role: 'assistant',
              text,
              at: new Date().toISOString()
            })
          )
          break
        }

        case 'assistant_message':
          streaming.current.delete(event.message.id)
          setTimeline((previous) => upsertMessage(previous, event.message))
          if (voiceChatRef.current) speakWithLocalVoice(event.message.text)
          break

        case 'tool_call':
          toolNamesByCallId.current.set(event.call.id, event.call.name)
          setTimeline((previous) => [
            ...previous,
            { kind: 'tool', id: event.call.id, call: event.call, status: 'pending' }
          ])
          break

        case 'tool_result': {
          const resultTool = toolNamesByCallId.current.get(event.result.callId)
          if (resultTool === 'record_transaction' && event.result.ok) {
            setFinanceRefresh((version) => version + 1)
          }
          if (resultTool === 'save_memory' && event.result.ok) {
            setMemoryVersion((version) => version + 1)
          }
          if (resultTool === 'schedule_agent_task' && event.result.ok) {
            void window.assist.getScheduledTasks().then(setScheduledTasks).catch((error: unknown) => {
              setAppWarning(`Scheduled tasks could not be refreshed: ${error instanceof Error ? error.message : String(error)}`)
            })
          }
          if (resultTool === 'save_skill' && event.result.ok) {
            void window.assist.getSkills().then(setSkills).catch((error: unknown) => {
              setAppWarning(`Skills could not be refreshed: ${error instanceof Error ? error.message : String(error)}`)
            })
          }
          toolNamesByCallId.current.delete(event.result.callId)
          setTimeline((previous) =>
            previous.map((item) =>
              item.kind === 'tool' && item.id === event.result.callId
                ? { ...item, status: statusFor(event.result), result: event.result }
                : item
            )
          )

          break
        }

        case 'permission_request':
          setPermission(event.request)
          setTimeline((previous) =>
            previous.map((item) =>
              item.kind === 'tool' && item.id === event.request.callId
                ? { ...item, status: 'awaiting' }
                : item
            )
          )
          break

        case 'permission_resolved':
          setPermission((current) => (current?.id === event.requestId ? null : current))
          setTimeline((previous) =>
            previous.map((item) =>
              item.kind === 'tool' && item.status === 'awaiting'
                ? { ...item, status: event.approved ? 'running' : 'denied' }
                : item
            )
          )
          break

        case 'audit':
          setAudit((previous) => [...previous, event.event])
          setAuditIntegrity((previous) => ({
            ...previous,
            chainedEvents: previous.chainedEvents + (event.event.hash ? 1 : 0)
          }))
          break

        case 'step':
          setStep({ index: event.index, max: event.max })
          break

        case 'error':
          setTimeline((previous) => [
            ...previous,
            { kind: 'message', message: systemMessage(event.message) }
          ])
          break

        case 'warning':
          setAppWarning(event.message)
          break

        case 'quick_capture_requested':
          setQuickCaptureOpen(true)
          break

        case 'busy':
          busyRef.current = event.busy
          setBusy(event.busy)
          if (!event.busy) {
            queueCompletionRef.current?.()
            queueCompletionRef.current = null
            setStep(null)
            void window.assist.getChatState().then((result) => {
              if (result.ok && result.state) setSessions(result.state.sessions)
              else setAppWarning(`Chat history could not be refreshed: ${result.error ?? 'the chat store is not ready.'}`)
            }).catch((error: unknown) => {
              setAppWarning(`Chat history could not be refreshed: ${error instanceof Error ? error.message : String(error)}`)
            })
          }
          break

        case 'local_api_activity':
          setLocalApiActivity(event.active ? { summary: event.summary } : null)
          busyRef.current = event.active
          setBusy(event.active)
          if (!event.active) setStep(null)
          break

        case 'scheduled_tasks_changed':
          void window.assist.getScheduledTasks().then(setScheduledTasks).catch((error: unknown) => {
            setAppWarning(`Scheduled tasks could not be refreshed: ${error instanceof Error ? error.message : String(error)}`)
          })
          break
      }
    })
  }, [])

  useEffect(() => {
    if (view === 'chat') {
      endRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [timeline, busy, view])

  useEffect(() => {
    if (view !== 'finances') return
    let alive = true
    setFinanceLoading(true)
    setFinanceError('')
    void window.assist.getFinanceReport(financePeriod).then(
      (report) => { if (alive) setFinanceReport(report) },
      (error: unknown) => { if (alive) setFinanceError(error instanceof Error ? error.message : String(error)) }
    ).finally(() => { if (alive) setFinanceLoading(false) })
    return () => { alive = false }
  }, [view, financePeriod, financeRefresh])

  const pushSystemMessage = useCallback((text: string) => {
    setTimeline((previous) => [...previous, { kind: 'message', message: systemMessage(text) }])
  }, [])

  const sendAgentMessage = useCallback(
    async (
      text?: string,
      modeOverride?: ChatMode,
      attachments?: ChatImageAttachmentInput[],
      effortOverride?: ChatEffort
    ): Promise<boolean> => {
      const value = (text ?? input).trim()
      if ((!value && !attachments?.length) || busy || queueRunning || directWorkflowRunningRef.current) return false

      busyRef.current = true
      setBusy(true)
      setInput('')

      try {
        const result = await window.assist.sendMessage(value, modeOverride ?? chatMode, attachments, effortOverride ?? chatEffort)
        if (!result.ok) {
          busyRef.current = false
          setBusy(false)
          setInput(value)
          setTimeline((previous) => [
            ...previous,
            { kind: 'message', message: systemMessage(result.error ?? 'Could not send that message.') }
          ])
          return false
        }
        return true
      } catch (error) {
        busyRef.current = false
        setBusy(false)
        setInput(value)
        setTimeline((previous) => [
          ...previous,
          {
            kind: 'message',
            message: systemMessage(error instanceof Error ? error.message : String(error))
          }
        ])
        return false
      }
    },
    [busy, input, queueRunning, chatMode, chatEffort]
  )

  const runCommand = useCallback(
    async (command: string) => {
      if (command.startsWith('/remember')) {
        const rest = command.slice('/remember'.length).trim()
        if (!rest) {
          pushSystemMessage("Usage: /remember [scope] fact — e.g. /remember teaching IELTS students meet weekly.")
          return
        }
        let scope: MemoryScope = 'general'
        let factText = rest
        for (const candidate of ['personal', 'teaching', 'business', 'general'] as const) {
          const prefix = `${candidate} `
          if (rest.toLowerCase().startsWith(prefix)) {
            scope = candidate
            factText = rest.slice(prefix.length).trim()
            break
          }
        }
        pushSystemMessage('Saving to memory — approve the card to confirm.')
        try {
          const result = await window.assist.addMemory({ text: factText, scope })
          if (result.ok) {
            const fact = result.output as { text?: string } | null
            setMemoryVersion((version) => version + 1)
            pushSystemMessage(`Remembered${fact?.text ? `: ${fact.text}` : ''}`)
          } else {
            pushSystemMessage(result.error ?? 'Memory save was not completed.')
          }
        } catch (error) {
          pushSystemMessage(error instanceof Error ? error.message : String(error))
        }
        return
      }

      if (command.startsWith('/recall')) {
        const query = command.slice('/recall'.length).trim()
        if (!query) {
          pushSystemMessage('Usage: /recall keywords — e.g. /recall Denizli IELTS.')
          return
        }
        try {
          const result = await window.assist.recallMemory(query, 6)
          if (result.ok && result.recall) {
            const lines = result.recall.facts.map(
              (fact, index) => `[M${index + 1}] (${fact.scope}) ${fact.text}`
            )
            pushSystemMessage(
              lines.length > 0 ? `Memory matches for "${query}":\n${lines.join('\n')}` : `No memory fact matched "${query}".`
            )
          } else {
            pushSystemMessage(result.error ?? 'Memory search did not complete.')
          }
        } catch (error) {
          pushSystemMessage(error instanceof Error ? error.message : String(error))
        }
        return
      }

      // /ask falls through as an ordinary agent message.
      const question = command.slice('/ask'.length).trim()
      if (!question) {
        pushSystemMessage('Usage: /ask your question')
        return
      }
      await sendAgentMessage(question)
    },
    [pushSystemMessage, sendAgentMessage]
  )

  const startTeachingPack = useCallback((pack: TeachingPack) => {
    setView('chat')
    void sendAgentMessage(pack.prompt)
  }, [sendAgentMessage])

  const prepareMeeting = useCallback((prompt: string) => {
    setChatMode('assistant')
    setInput((current) => current.trim() ? `${current.trimEnd()}\n\n${prompt}` : prompt)
    setView('chat')
  }, [])

  const prepareGuidedChat = useCallback((prompt: string, mode: ChatMode): boolean => {
    if (busyRef.current || queueRunningRef.current || directWorkflowRunningRef.current) return false
    const currentDraft = input.trimEnd()
    const separator = currentDraft ? '\n\n' : ''
    if (currentDraft.length + separator.length + prompt.length > MAX_CHAT_MESSAGE_CHARS) return false
    setChatMode(mode)
    setInput(currentDraft ? `${currentDraft}${separator}${prompt}` : prompt)
    setView('chat')
    return true
  }, [input])

  const prepareCloudFileChat = useCallback((prompt: string): boolean => {
    if (busyRef.current || queueRunningRef.current || directWorkflowRunningRef.current) return false
    const currentDraft = input.trimEnd()
    const separator = currentDraft ? '\n\n' : ''
    if (currentDraft.length + separator.length + prompt.length > MAX_CHAT_MESSAGE_CHARS) return false
    setChatMode('assistant')
    setInput(currentDraft ? `${currentDraft}${separator}${prompt}` : prompt)
    setView('chat')
    return true
  }, [input])

  const startCoachingChat = useCallback(async (area: CoachArea, prompt: string) => {
    if (busyRef.current || queueRunningRef.current || directWorkflowRunningRef.current) return
    try {
      const result = await window.assist.createChat()
      if (!result.ok || !result.state) {
        setTimeline((previous) => [...previous, {
          kind: 'message',
          message: systemMessage(result.error ?? 'Could not start a separate coaching chat.')
        }])
        return
      }
      streaming.current.clear()
      setSessions(result.state.sessions)
      setActiveSessionId(result.state.activeSessionId)
      setTimeline(timelineFor(result.state.messages))
      setPermission(null)
      const mode: ChatMode = area === 'personal' ? 'coach_personal' : 'coach_business'
      setChatMode(mode)
      setView('chat')
      await sendAgentMessage(prompt, mode)
    } catch (error) {
      setTimeline((previous) => [...previous, {
        kind: 'message',
        message: systemMessage(error instanceof Error ? error.message : String(error))
      }])
    }
  }, [sendAgentMessage])

  const send = useCallback(
    async (text?: string, attachments?: ChatImageAttachmentInput[], effort?: ChatEffort): Promise<boolean> => {
      const value = (text ?? input).trim()
      if (!value && !attachments?.length) return false

      const command = attachments?.length ? null : /^\/(remember|recall|ask)(\s|$)/.exec(value)
      if (command) {
        await runCommand(value)
        setInput('')
        return true
      }
      return sendAgentMessage(value, undefined, attachments, effort)
    },
    [input, runCommand, sendAgentMessage]
  )

  const queueCurrentTask = useCallback(() => {
    const task = input.trim()
    if (!task) return
    const next = [...queuedTasksRef.current, task]
    queuedTasksRef.current = next
    setQueuedTasks(next)
    setInput('')
  }, [input])

  const removeQueuedTask = useCallback((index: number) => {
    const next = queuedTasksRef.current.filter((_task, taskIndex) => taskIndex !== index)
    queuedTasksRef.current = next
    setQueuedTasks(next)
  }, [])

  const runQueue = useCallback(async () => {
    if (queueRunningRef.current || directWorkflowRunningRef.current || busyRef.current || queuedTasksRef.current.length === 0) return
    queueRunningRef.current = true
    setQueueRunning(true)

    try {
      while (queueRunningRef.current && queuedTasksRef.current.length > 0) {
        const [task, ...remaining] = queuedTasksRef.current
        queuedTasksRef.current = remaining
        setQueuedTasks(remaining)
        busyRef.current = true
        setBusy(true)

        const completion = new Promise<void>((resolve) => {
          queueCompletionRef.current = resolve
        })

        try {
          const result = await window.assist.sendMessage(task, chatModeRef.current, undefined, chatEffortRef.current)
          if (!result.ok) {
            queueCompletionRef.current = null
            busyRef.current = false
            setBusy(false)
            setTimeline((previous) => [
              ...previous,
              { kind: 'message', message: systemMessage(result.error ?? 'Could not start queued task.') }
            ])
            break
          }
          await completion
        } catch (error) {
          queueCompletionRef.current = null
          busyRef.current = false
          setBusy(false)
          setTimeline((previous) => [
            ...previous,
            {
              kind: 'message',
              message: systemMessage(error instanceof Error ? error.message : String(error))
            }
          ])
          break
        }
      }
    } finally {
      queueRunningRef.current = false
      setQueueRunning(false)
    }
  }, [])

  const cancel = useCallback(() => {
    if (queueRunningRef.current) {
      queueRunningRef.current = false
      setQueueRunning(false)
    }
    void window.assist.cancel().catch((error: unknown) => {
      pushSystemMessage(`Could not stop the active task: ${error instanceof Error ? error.message : String(error)}`)
    })
  }, [pushSystemMessage])

  const toggleVoiceChat = useCallback(() => {
    setVoiceChatEnabled((enabled) => !enabled)
  }, [])

  const changeChat = useCallback(async (sessionId?: string, mode: ChatMode = 'assistant'): Promise<void> => {
    if (busy || queueRunning || workflowRunningId) return
    try {
      const result = sessionId
        ? await window.assist.switchChat(sessionId)
        : await window.assist.createChat()
      if (!result.ok || !result.state) {
        setTimeline((previous) => [
          ...previous,
          { kind: 'message', message: systemMessage(result.error ?? 'Could not switch conversations.') }
        ])
        return
      }

      streaming.current.clear()
      setSessions(result.state.sessions)
      setActiveSessionId(result.state.activeSessionId)
      setTimeline(timelineFor(result.state.messages))
      setPermission(null)
      setChatMode(mode)
      setSessionSearch('')
      setRenamingSession(false)
    } catch (error) {
      setTimeline((previous) => [
        ...previous,
        {
          kind: 'message',
          message: systemMessage(error instanceof Error ? error.message : String(error))
        }
      ])
    }
  }, [busy, queueRunning, workflowRunningId])

  const handleGlobalSearchSelection = useCallback(async (selection: GlobalSearchSelection): Promise<void> => {
    const requestId = ++globalSearchSelectionRef.current
    setGlobalSearchOpen(false)
    setAppWarning('')
    if ((selection.kind === 'chat' || (selection.kind === 'action' && selection.action === 'new-chat')) && (busy || queueRunning || workflowRunningId)) {
      setAppWarning('Finish the active task before switching conversations.')
      return
    }
    if (selection.kind === 'view') {
      navigateToView(selection.view)
    } else if (selection.kind === 'action') {
      if (selection.action === 'new-chat') {
        navigateToView('chat')
        void changeChat()
      } else {
        setQuickCaptureOpen(true)
      }
    } else if (selection.kind === 'chat') {
      navigateToView('chat')
      void changeChat(selection.sessionId, selection.mode)
    } else if (selection.kind === 'vault') {
      navigateToView('vault')
      setPendingVaultDocument(null)
      try {
        const result = await window.assist.getVaultDocument(selection.document.id)
        if (requestId !== globalSearchSelectionRef.current) return
        if (!result.ok || !result.document) throw new Error(result.error ?? 'That vault note is no longer available.')
        setPendingVaultDocument(result.document)
      } catch (error) {
        if (requestId !== globalSearchSelectionRef.current) return
        setAppWarning(`Could not open that note: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else if (selection.kind === 'today-task' || selection.kind === 'today-inbox') {
      setTodaySearchTarget(selection)
      navigateToView('today')
    } else if (selection.kind === 'memory') {
      setSelectedMemoryResult({ fact: selection.fact, query: selection.query })
      openMemorySettings()
    } else if (selection.kind === 'workflow') {
      setWorkflowSearchTarget(selection.id)
      navigateToView('workflows')
    } else if (selection.kind === 'scheduled') {
      setScheduledSearchTarget(selection.id)
      navigateToView('scheduled')
    } else if (selection.kind === 'skill') {
      setSkillSearchTarget(selection.id)
      navigateToView('skills')
    }
  }, [busy, changeChat, navigateToView, openMemorySettings, queueRunning, workflowRunningId])

  const clearTodaySearchTarget = useCallback((): void => setTodaySearchTarget(null), [])
  const clearPendingVaultDocument = useCallback((): void => setPendingVaultDocument(null), [])
  const clearSelectedMemoryFact = useCallback((): void => setSelectedMemoryResult(null), [])
  const clearWorkflowSearchTarget = useCallback((): void => setWorkflowSearchTarget(null), [])
  const clearScheduledSearchTarget = useCallback((): void => setScheduledSearchTarget(null), [])
  const clearSkillSearchTarget = useCallback((): void => setSkillSearchTarget(null), [])

  useEffect(() => {
    const q = sessionSearch.trim()
    if (!q) {
      setFilteredSessions(null)
      return
    }
    let cancelled = false
    void window.assist.searchChats(q, chatMode).then((matches) => {
      if (!cancelled) setFilteredSessions(matches)
    }).catch((error: unknown) => {
      if (!cancelled) setAppWarning(`Conversation search failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    return () => {
      cancelled = true
    }
  }, [sessionSearch, chatMode, sessions])

  const renameActiveChat = useCallback(async (): Promise<void> => {
    if (!activeSessionId || !renameDraft.trim()) return
    try {
      const result = await window.assist.renameChat(activeSessionId, renameDraft.trim())
      if (result.ok && result.state) {
        setSessions(result.state.sessions)
        setRenamingSession(false)
      } else {
        pushSystemMessage(result.error ?? 'Could not rename this conversation.')
      }
    } catch (error) {
      pushSystemMessage(`Could not rename this conversation: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [activeSessionId, renameDraft, pushSystemMessage])

  const deleteActiveChat = useCallback(async (): Promise<void> => {
    if (!activeSessionId || busy || queueRunning || workflowRunningId) return
    try {
      const result = await window.assist.deleteChat(activeSessionId)
      if (result.ok && result.state) {
        streaming.current.clear()
        setSessions(result.state.sessions)
        setActiveSessionId(result.state.activeSessionId)
        setTimeline(timelineFor(result.state.messages))
        setPermission(null)
        setRenamingSession(false)
      } else {
        pushSystemMessage(result.error ?? 'Could not delete this conversation.')
      }
    } catch (error) {
      pushSystemMessage(`Could not delete this conversation: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [activeSessionId, busy, queueRunning, workflowRunningId, pushSystemMessage])

  const exportActiveChat = useCallback(async (): Promise<void> => {
    if (!activeSessionId) return
    try {
      const result = await window.assist.exportChat(activeSessionId)
      if (result.ok && result.fileName) {
        pushSystemMessage(`Exported conversation to ${result.fileName}.`)
      } else if (!result.cancelled && result.error) {
        pushSystemMessage(result.error)
      }
    } catch (error) {
      pushSystemMessage(`Could not export this conversation: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [activeSessionId, pushSystemMessage])

  const deleteMessageFromActiveChat = useCallback(async (messageId: string): Promise<void> => {
    if (!activeSessionId || busy || queueRunning || workflowRunningId) return
    try {
      const result = await window.assist.deleteChatMessage(activeSessionId, messageId)
      if (result.ok && result.state) {
        setTimeline(timelineFor(result.state.messages))
      } else {
        pushSystemMessage(result.error ?? 'Could not delete this message.')
      }
    } catch (error) {
      pushSystemMessage(`Could not delete this message: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [activeSessionId, busy, queueRunning, workflowRunningId, pushSystemMessage])

  const respond = useCallback(
    (choice: ApprovalChoice) => {
      const request = permission
      if (!request) return

      setPermission(null)
      void window.assist.respondPermission(request.id, choice).catch((error: unknown) => {
        setPermission((current) => current && current.id !== request.id ? current : request)
        setTimeline((previous) => [
          ...previous,
          {
            kind: 'message',
            message: systemMessage(
              `Could not deliver your decision: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        ])
      })
    },
    [permission]
  )

  const saveSettings = useCallback(async (patch: SettingsPatch): Promise<SettingsResult> => {
    const result = await window.assist.updateSettings(patch)
    if (result.ok && result.settings) setSettings(result.settings)
    return result
  }, [])

  const setLocalApiEnabled = useCallback(async (enabled: boolean): Promise<LocalApiResult> => {
    const result = await window.assist.setLocalApiEnabled(enabled)
    if (result.status) setLocalApiStatus(result.status)
    return result
  }, [])

  const updateWebSearchApiKey = useCallback(async (apiKey: string | null): Promise<WebSearchSettingsResult> => {
    const result = await window.assist.updateWebSearchApiKey(apiKey)
    if (result.ok && result.settings) setWebSearchSettings(result.settings)
    return result
  }, [])

  const updateNotionApiKey = useCallback(async (apiKey: string | null): Promise<NotionSettingsResult> => {
    const result = await window.assist.updateNotionApiKey(apiKey)
    if (result.ok && result.settings) setNotionSettings(result.settings)
    return result
  }, [])

  const updateGitHubToken = useCallback(async (token: string | null): Promise<GitHubSettingsResult> => {
    const result = await window.assist.updateGitHubToken(token)
    if (result.ok && result.settings) setGitHubSettings(result.settings)
    return result
  }, [])

  const updateGoogleCalendarClientId = useCallback(async (clientId: string): Promise<GoogleCalendarSettingsResult> => {
    const result = await window.assist.updateGoogleCalendarClientId(clientId)
    if (result.ok && result.settings) setGoogleCalendarSettings(result.settings)
    return result
  }, [])

  const connectGoogleCalendar = useCallback(async (): Promise<GoogleCalendarSettingsResult> => {
    const result = await window.assist.connectGoogleCalendar()
    if (result.ok && result.settings) setGoogleCalendarSettings(result.settings)
    return result
  }, [])

  const disconnectGoogleCalendar = useCallback(async (): Promise<GoogleCalendarSettingsResult> => {
    const result = await window.assist.disconnectGoogleCalendar()
    if (result.ok && result.settings) setGoogleCalendarSettings(result.settings)
    return result
  }, [])

  const updateGoogleGmailClientId = useCallback(async (clientId: string): Promise<GoogleGmailSettingsResult> => {
    const result = await window.assist.updateGoogleGmailClientId(clientId)
    if (result.ok && result.settings) setGoogleGmailSettings(result.settings)
    return result
  }, [])

  const connectGoogleGmail = useCallback(async (): Promise<GoogleGmailSettingsResult> => {
    const result = await window.assist.connectGoogleGmail()
    if (result.ok && result.settings) setGoogleGmailSettings(result.settings)
    return result
  }, [])

  const disconnectGoogleGmail = useCallback(async (): Promise<GoogleGmailSettingsResult> => {
    const result = await window.assist.disconnectGoogleGmail()
    if (result.ok && result.settings) setGoogleGmailSettings(result.settings)
    return result
  }, [])

  const updateGoogleDriveClientId = useCallback(async (clientId: string): Promise<GoogleDriveSettingsResult> => {
    const result = await window.assist.updateGoogleDriveClientId(clientId)
    if (result.ok && result.settings) setGoogleDriveSettings(result.settings)
    return result
  }, [])

  const connectGoogleDrive = useCallback(async (): Promise<GoogleDriveSettingsResult> => {
    const result = await window.assist.connectGoogleDrive()
    if (result.ok && result.settings) setGoogleDriveSettings(result.settings)
    return result
  }, [])

  const disconnectGoogleDrive = useCallback(async (): Promise<GoogleDriveSettingsResult> => {
    const result = await window.assist.disconnectGoogleDrive()
    if (result.ok && result.settings) setGoogleDriveSettings(result.settings)
    return result
  }, [])

  const updateGoogleTasksClientId = useCallback(async (clientId: string): Promise<GoogleTasksSettingsResult> => {
    const result = await window.assist.updateGoogleTasksClientId(clientId)
    if (result.ok && result.settings) setGoogleTasksSettings(result.settings)
    return result
  }, [])

  const connectGoogleTasks = useCallback(async (): Promise<GoogleTasksSettingsResult> => {
    const result = await window.assist.connectGoogleTasks()
    if (result.ok && result.settings) setGoogleTasksSettings(result.settings)
    return result
  }, [])

  const disconnectGoogleTasks = useCallback(async (): Promise<GoogleTasksSettingsResult> => {
    const result = await window.assist.disconnectGoogleTasks()
    if (result.ok && result.settings) setGoogleTasksSettings(result.settings)
    return result
  }, [])

  const updateMicrosoftTodoClientId = useCallback(async (clientId: string): Promise<MicrosoftTodoSettingsResult> => {
    const result = await window.assist.updateMicrosoftTodoClientId(clientId)
    if (result.ok && result.settings) setMicrosoftTodoSettings(result.settings)
    return result
  }, [])

  const beginMicrosoftTodoConnect = useCallback(async (): Promise<MicrosoftTodoSettingsResult> => {
    const result = await window.assist.beginMicrosoftTodoConnect()
    if (result.ok && result.settings) setMicrosoftTodoSettings(result.settings)
    return result
  }, [])

  const getMicrosoftTodoConnectStatus = useCallback(async (): Promise<MicrosoftTodoConnectStatusResult> => {
    const result = await window.assist.getMicrosoftTodoConnectStatus()
    if (result.ok && result.settings) setMicrosoftTodoSettings(result.settings)
    return result
  }, [])

  const cancelMicrosoftTodoConnect = useCallback(async (): Promise<MicrosoftTodoConnectStatusResult> => {
    const result = await window.assist.cancelMicrosoftTodoConnect()
    if (result.ok && result.settings) setMicrosoftTodoSettings(result.settings)
    return result
  }, [])

  const disconnectMicrosoftTodo = useCallback(async (): Promise<MicrosoftTodoSettingsResult> => {
    const result = await window.assist.disconnectMicrosoftTodo()
    if (result.ok && result.settings) setMicrosoftTodoSettings(result.settings)
    return result
  }, [])

  const updateMicrosoftCalendarClientId = useCallback(async (clientId: string): Promise<MicrosoftCalendarSettingsResult> => {
    const result = await window.assist.updateMicrosoftCalendarClientId(clientId)
    if (result.ok && result.settings) setMicrosoftCalendarSettings(result.settings)
    return result
  }, [])

  const beginMicrosoftCalendarConnect = useCallback(async (): Promise<MicrosoftCalendarSettingsResult> => {
    const result = await window.assist.beginMicrosoftCalendarConnect()
    if (result.ok && result.settings) setMicrosoftCalendarSettings(result.settings)
    return result
  }, [])

  const getMicrosoftCalendarConnectStatus = useCallback(async (): Promise<MicrosoftCalendarConnectStatusResult> => {
    const result = await window.assist.getMicrosoftCalendarConnectStatus()
    if (result.ok && result.settings) setMicrosoftCalendarSettings(result.settings)
    return result
  }, [])

  const cancelMicrosoftCalendarConnect = useCallback(async (): Promise<MicrosoftCalendarConnectStatusResult> => {
    const result = await window.assist.cancelMicrosoftCalendarConnect()
    if (result.ok && result.settings) setMicrosoftCalendarSettings(result.settings)
    return result
  }, [])

  const disconnectMicrosoftCalendar = useCallback(async (): Promise<MicrosoftCalendarSettingsResult> => {
    const result = await window.assist.disconnectMicrosoftCalendar()
    if (result.ok && result.settings) setMicrosoftCalendarSettings(result.settings)
    return result
  }, [])

  const updateMicrosoftMailClientId = useCallback(async (clientId: string): Promise<MicrosoftMailSettingsResult> => {
    const result = await window.assist.updateMicrosoftMailClientId(clientId)
    if (result.ok && result.settings) setMicrosoftMailSettings(result.settings)
    return result
  }, [])

  const beginMicrosoftMailConnect = useCallback(async (): Promise<MicrosoftMailSettingsResult> => {
    const result = await window.assist.beginMicrosoftMailConnect()
    if (result.ok && result.settings) setMicrosoftMailSettings(result.settings)
    return result
  }, [])

  const getMicrosoftMailConnectStatus = useCallback(async (): Promise<MicrosoftMailConnectStatusResult> => {
    const result = await window.assist.getMicrosoftMailConnectStatus()
    if (result.ok && result.settings) setMicrosoftMailSettings(result.settings)
    return result
  }, [])

  const cancelMicrosoftMailConnect = useCallback(async (): Promise<MicrosoftMailConnectStatusResult> => {
    const result = await window.assist.cancelMicrosoftMailConnect()
    if (result.ok && result.settings) setMicrosoftMailSettings(result.settings)
    return result
  }, [])

  const disconnectMicrosoftMail = useCallback(async (): Promise<MicrosoftMailSettingsResult> => {
    const result = await window.assist.disconnectMicrosoftMail()
    if (result.ok && result.settings) setMicrosoftMailSettings(result.settings)
    return result
  }, [])

  const updateMicrosoftOneDriveClientId = useCallback(async (clientId: string): Promise<MicrosoftOneDriveSettingsResult> => {
    const result = await window.assist.updateMicrosoftOneDriveClientId(clientId)
    if (result.ok && result.settings) setMicrosoftOneDriveSettings(result.settings)
    return result
  }, [])

  const beginMicrosoftOneDriveConnect = useCallback(async (): Promise<MicrosoftOneDriveSettingsResult> => {
    const result = await window.assist.beginMicrosoftOneDriveConnect()
    if (result.ok && result.settings) setMicrosoftOneDriveSettings(result.settings)
    return result
  }, [])

  const getMicrosoftOneDriveConnectStatus = useCallback(async (): Promise<MicrosoftOneDriveConnectStatusResult> => {
    const result = await window.assist.getMicrosoftOneDriveConnectStatus()
    if (result.ok && result.settings) setMicrosoftOneDriveSettings(result.settings)
    return result
  }, [])

  const cancelMicrosoftOneDriveConnect = useCallback(async (): Promise<MicrosoftOneDriveConnectStatusResult> => {
    const result = await window.assist.cancelMicrosoftOneDriveConnect()
    if (result.ok && result.settings) setMicrosoftOneDriveSettings(result.settings)
    return result
  }, [])

  const disconnectMicrosoftOneDrive = useCallback(async (): Promise<MicrosoftOneDriveSettingsResult> => {
    const result = await window.assist.disconnectMicrosoftOneDrive()
    if (result.ok && result.settings) setMicrosoftOneDriveSettings(result.settings)
    return result
  }, [])

  const testProvider = useCallback((): Promise<ProviderStatus> => {
    return window.assist.testProvider()
  }, [])

  const exportAudit = useCallback((): Promise<AuditExportResult> => {
    return window.assist.exportAudit()
  }, [])

  const createBackup = useCallback((passphrase?: string): Promise<BackupResult> => {
    return window.assist.createBackup(passphrase)
  }, [])

  const restoreBackup = useCallback(async (passphrase?: string): Promise<BackupResult> => {
    const res = await window.assist.restoreBackup(passphrase)
    if (res.ok) {
      const chatState = await window.assist.getChatState()
      if (chatState.ok && chatState.state) {
        setSessions(chatState.state.sessions)
        setActiveSessionId(chatState.state.activeSessionId)
        setTimeline(timelineFor(chatState.state.messages))
      }
      setFinanceRefresh((v) => v + 1)
      setMemoryVersion((v) => v + 1)
      void Promise.all([
        window.assist.getSettings().then(setSettings),
        window.assist.getWebSearchSettings().then(setWebSearchSettings),
        window.assist.getNotionSettings().then(setNotionSettings),
        window.assist.getGitHubSettings().then(setGitHubSettings),
        window.assist.getGoogleCalendarSettings().then(setGoogleCalendarSettings),
        window.assist.getGoogleGmailSettings().then(setGoogleGmailSettings),
        window.assist.getGoogleDriveSettings().then(setGoogleDriveSettings),
        window.assist.getAllowedDomains().then(setAllowedDomains),
        window.assist.getSpeechEndpoint().then(setSpeechEndpoint),
        window.assist.getWorkflows().then(setWorkflows),
        window.assist.getScheduledTasks().then(setScheduledTasks),
        window.assist.getSkills().then(setSkills),
        window.assist.getGoogleTasksSettings().then(setGoogleTasksSettings),
        window.assist.getMicrosoftTodoSettings().then(setMicrosoftTodoSettings),
        window.assist.getMicrosoftCalendarSettings().then(setMicrosoftCalendarSettings),
        window.assist.getMicrosoftMailSettings().then(setMicrosoftMailSettings),
        window.assist.getMicrosoftOneDriveSettings().then(setMicrosoftOneDriveSettings),
        window.assist.getAudit().then(setAudit),
        window.assist.getAuditIntegrity().then(setAuditIntegrity)
      ]).catch((error: unknown) => {
        setAppWarning(`Some app data could not be refreshed after backup restore: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    return res
  }, [])

  const recordFinanceTransaction = useCallback(async (transaction: FinanceTransactionInput) => {
    setFinanceEntryBusy(true)
    try {
      const result = await window.assist.recordFinanceTransaction(transaction)
      if (result.ok) setFinanceRefresh((version) => version + 1)
      return result
    } finally {
      setFinanceEntryBusy(false)
    }
  }, [])

  const saveWorkflow = useCallback(async (name: string): Promise<WorkflowMutationResult> => {
    const draft = workflowDraftFor(timeline)
    if (!draft) return { ok: false, error: 'There is no completed eligible tool sequence to save.' }
    const result = await window.assist.saveWorkflow({ name, prompt: draft.prompt, steps: draft.steps })
    if (result.workflows) setWorkflows(result.workflows)
    return result
  }, [timeline])

  const removeWorkflow = useCallback(async (id: string): Promise<{ ok: boolean; error?: string }> => {
    const result = await window.assist.removeWorkflow(id)
    if (result.workflows) setWorkflows(result.workflows)
    return { ok: result.ok, error: result.error }
  }, [])

  const createScheduledTask = useCallback(async (input: {
    name: string
    prompt: string
    mode: ChatMode
    schedule: ScheduledTaskSchedule
  }): Promise<ScheduledTaskMutationResult> => {
    const result = await window.assist.createScheduledTask(input)
    if (result.tasks) setScheduledTasks(result.tasks)
    return result
  }, [])

  const setScheduledTaskEnabled = useCallback(async (id: string, enabled: boolean): Promise<ScheduledTaskMutationResult> => {
    const result = await window.assist.setScheduledTaskEnabled(id, enabled)
    if (result.tasks) setScheduledTasks(result.tasks)
    return result
  }, [])

  const removeScheduledTask = useCallback(async (id: string): Promise<ScheduledTaskMutationResult> => {
    const result = await window.assist.removeScheduledTask(id)
    if (result.tasks) setScheduledTasks(result.tasks)
    return result
  }, [])

  const runScheduledTask = useCallback(async (id: string): Promise<ScheduledTaskRunResult> => {
    const result = await window.assist.runScheduledTask(id)
    const updated = await window.assist.getScheduledTasks()
    setScheduledTasks(updated)
    return result
  }, [])

  const saveSkill = useCallback(async (input: AssistantSkillInput): Promise<SkillMutationResult> => {
    const result = await window.assist.saveSkill(input)
    if (result.skills) setSkills(result.skills)
    return result
  }, [])

  const setSkillEnabled = useCallback(async (id: string, enabled: boolean): Promise<SkillMutationResult> => {
    const result = await window.assist.setSkillEnabled(id, enabled)
    if (result.skills) setSkills(result.skills)
    return result
  }, [])

  const deleteSkill = useCallback(async (id: string): Promise<SkillMutationResult> => {
    const result = await window.assist.deleteSkill(id)
    if (result.skills) setSkills(result.skills)
    return result
  }, [])

  const runWorkflow = useCallback(async (id: string, params?: Record<string, string>): Promise<WorkflowRunResult> => {
    if (busyRef.current || directWorkflowRunningRef.current || queueRunningRef.current) {
      return { ok: false, completedSteps: 0, totalSteps: 0, error: 'Wait for the active task to finish.' }
    }
    directWorkflowRunningRef.current = true
    setWorkflowRunningId(id)
    try {
      return await window.assist.runWorkflow(id, params)
    } finally {
      directWorkflowRunningRef.current = false
      setWorkflowRunningId(null)
    }
  }, [])

  const updateSpeechEndpoint = useCallback(async (endpoint: string) => {
    const result = await window.assist.updateSpeechEndpoint(endpoint)
    if (result.ok && result.endpoint !== undefined) setSpeechEndpoint(result.endpoint)
    return result
  }, [])

  const transcribeAudio = useCallback(
    (audio: Uint8Array, mimeType: string): Promise<SpeechResult> =>
      window.assist.transcribeAudio(audio, mimeType),
    []
  )

  const completeOnboarding = useCallback(async (): Promise<void> => {
    const result = await window.assist.completeOnboarding()
    if (result.ok && result.settings) {
      setSettings(result.settings)
      setOnboardingOpen(false)
    } else if (result.error) {
      const errorMessage = result.error
      setTimeline((previous) => [
        ...previous,
        { kind: 'message', message: systemMessage(errorMessage) }
      ])
    }
  }, [])

  const addGrant = useCallback(
    async (access: 'read' | 'read-write'): Promise<GrantMutationResult> => {
      const result = await window.assist.addGrant(access)
      if (result.grants) setGrants(result.grants)
      return result
    },
    []
  )

  const removeGrant = useCallback(async (id: string): Promise<GrantMutationResult> => {
    const result = await window.assist.removeGrant(id)
    if (result.grants) setGrants(result.grants)
    return result
  }, [])

  const setGrantAccess = useCallback(
    async (id: string, access: 'read' | 'read-write'): Promise<GrantMutationResult> => {
      const result = await window.assist.setGrantAccess(id, access)
      if (result.grants) setGrants(result.grants)
      return result
    },
    []
  )

  const addAllowedDomain = useCallback(async (host: string): Promise<DomainMutationResult> => {
    const result = await window.assist.addAllowedDomain(host)
    if (result.domains) setAllowedDomains(result.domains)
    return result
  }, [])

  const removeAllowedDomain = useCallback(async (host: string): Promise<DomainMutationResult> => {
    const result = await window.assist.removeAllowedDomain(host)
    if (result.domains) setAllowedDomains(result.domains)
    return result
  }, [])

  const retryStartupLoad = (key: StartupLoadKey): void => {
    startupReloaders.current.get(key)?.()
  }

  const gateStartupView = (
    keys: StartupLoadKey[],
    label: string,
    content: React.ReactNode
  ): React.ReactNode => {
    const failedKeys = keys.filter((key) => startupLoads[key]?.status === 'error')
    const pending = keys.some((key) => startupLoads[key]?.status !== 'loaded')
    if (failedKeys.length > 0) {
      const details = failedKeys.map((key) => `${STARTUP_LOAD_LABELS[key]}: ${startupLoads[key]?.error ?? 'load failed'}`).join('; ')
      return (
        <StartupLoadNotice
          label={label}
          loading={false}
          error={`Could not load ${label}. ${details}`}
          onRetry={() => failedKeys.forEach((key) => retryStartupLoad(key))}
        />
      )
    }
    if (pending) return <StartupLoadNotice label={label} loading error="" onRetry={() => {}} />
    return content
  }

  const preset = settings ? presetFor(settings.provider.preset) : null
  const conversationStarted = timeline.some(
    (item) => item.kind === 'message' && item.message.role !== 'system'
  )
  const sidebarChatSessions = (sessionSearch.trim() ? filteredSessions ?? [] : sessions)
    .filter((session) => conversationStarted || session.id !== activeSessionId)

  return (
    <div className={`app ${sidebarVisibility === 'closed' ? 'sidebar-closed' : ''}`}>
      <Sidebar
        sidebarVisibility={sidebarVisibility}
        onToggleSidebar={toggleSidebar}
        view={view}
        onChange={navigateToView}
        onGlobalSearch={() => setGlobalSearchOpen(true)}
        onQuickCapture={() => setQuickCaptureOpen(true)}
        auditCount={audit.length}
        grants={grants}
        model={settings?.provider.model ?? ''}
        preset={preset?.label ?? ''}
        chatSessions={sidebarChatSessions}
        activeChatId={activeSessionId}
        chatSearch={sessionSearch}
        onChatSearchChange={setSessionSearch}
        onSelectChat={(sessionId) => {
          navigateToView('chat')
          void changeChat(sessionId)
        }}
        chatSwitchDisabled={busy || queueRunning || Boolean(workflowRunningId)}
      />
      {quickCaptureOpen && (
        <Suspense fallback={<div className="quick-capture-loading" role="status">Opening quick capture…</div>}>
          <QuickCaptureDialog open={quickCaptureOpen} onClose={() => setQuickCaptureOpen(false)} />
        </Suspense>
      )}
      {globalSearchOpen && (
        <Suspense fallback={<div className="global-search-loading" role="status">Opening local search…</div>}>
          <GlobalSearchDialog
            open={globalSearchOpen}
            workflows={workflows}
            scheduledTasks={scheduledTasks}
            skills={skills}
            onClose={() => setGlobalSearchOpen(false)}
            onSelect={(selection) => void handleGlobalSearchSelection(selection)}
          />
        </Suspense>
      )}

      <main className="main">
        <header className="topbar">
          {sidebarVisibility === 'closed' && (
            <button
              type="button"
              className="sidebar-toggle-button sidebar-open-button"
              aria-controls="app-sidebar"
              aria-expanded="false"
              onClick={toggleSidebar}
            >
              <span aria-hidden="true">☰</span>
              Open sidebar
            </button>
          )}
          <div className="topbar-titles">
            <div className="topbar-title-line">
              <h1>{VIEW_META[view].label}</h1>
            </div>
            <p>{VIEW_META[view].description}</p>
          </div>
          <div className="topbar-meta">
            {localApiActivity && (
              <>
                <span className="step-badge" title={localApiActivity.summary ?? 'A local API request is active.'}>
                  Local API request
                </span>
                <button className="stop-button" type="button" onClick={cancel}>Stop API request</button>
              </>
            )}
            {queueRunning && <button className="stop-button" type="button" onClick={cancel}>Stop queue</button>}
            {workflowRunningId && <button className="stop-button" type="button" onClick={cancel}>Stop workflow</button>}
            {view === 'chat' && (
              <div className="session-controls">
                {conversationStarted && (renamingSession ? (
                  <div className="session-rename-inline">
                    <input
                      value={renameDraft}
                      maxLength={80}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      aria-label="Conversation title"
                    />
                    <button type="button" className="ghost-button" onClick={() => void renameActiveChat()}>
                      Save
                    </button>
                    <button type="button" className="ghost-button" onClick={() => setRenamingSession(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={busy || queueRunning || Boolean(workflowRunningId)}
                    onClick={() => {
                      const current = sessions.find((s) => s.id === activeSessionId)
                      setRenameDraft(current?.title ?? '')
                      setRenamingSession(true)
                    }}
                  >
                    Rename
                  </button>
                ))}
                {conversationStarted && (
                  <>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={!activeSessionId}
                      onClick={() => void exportActiveChat()}
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={busy || queueRunning || Boolean(workflowRunningId)}
                      onClick={() => void deleteActiveChat()}
                    >
                      Delete
                    </button>
                  </>
                )}
                <button type="button" className="new-chat-button" disabled={busy || queueRunning || Boolean(workflowRunningId)} onClick={() => void changeChat()}>
                  New chat
                </button>
              </div>
            )}
            {busy && step && (
              <span className="step-badge">
                Step {step.index} of {step.max}
              </span>
            )}
          </div>
        </header>

        {appWarning && (
          <div className="app-warning" role="status" aria-live="polite">
            <span>{appWarning}</span>
            <button type="button" onClick={() => setAppWarning('')} aria-label="Dismiss warning">Dismiss</button>
          </div>
        )}

        <div className="content">
          <Suspense fallback={<div className="view-loading" role="status">Loading section…</div>}>
          {view === 'chat' && gateStartupView(CHAT_STARTUP_KEYS, 'chat data', (
            <ChatView
              items={timeline}
              chatMode={chatMode}
              onChatModeChange={setChatMode}
              chatEffort={chatEffort}
              onChatEffortChange={setChatEffort}
              busy={busy || queueRunning || Boolean(workflowRunningId)}
              input={input}
              onInputChange={setInput}
              onSend={send}
              providerSettings={settings?.provider ?? null}
              onUpdateProvider={saveSettings}
              onRefreshModels={testProvider}
              onCancel={cancel}
              speechEndpoint={speechEndpoint}
              onTranscribe={transcribeAudio}
              voiceChatEnabled={voiceChatEnabled}
              onToggleVoiceChat={toggleVoiceChat}
              queuedTasks={queuedTasks}
              queueRunning={queueRunning}
              onQueueTask={queueCurrentTask}
              onRemoveQueuedTask={removeQueuedTask}
              onRunQueue={() => void runQueue()}
              workflowCandidate={workflowDraftFor(timeline)}
              onSaveWorkflow={saveWorkflow}
              providerEndpoint={settings?.provider.baseUrl ?? ''}
              providerSetupRequired={!settings || Boolean(preset?.needsKey && !settings.provider.hasApiKey)}
              onOpenSettings={() => navigateToView('settings')}
              endRef={endRef}
              onDeleteMessage={(messageId) => void deleteMessageFromActiveChat(messageId)}
              onCitationClick={openMemorySettings}
            />
          ))}

          {view === 'today' && <TodayView
            searchTarget={todaySearchTarget}
            onSearchTargetConsumed={clearTodaySearchTarget}
            googleCalendarSettings={googleCalendarSettings}
            googleGmailSettings={googleGmailSettings}
            googleTasksSettings={googleTasksSettings}
            microsoftTodoSettings={microsoftTodoSettings}
            microsoftCalendarSettings={microsoftCalendarSettings}
            microsoftMailSettings={microsoftMailSettings}
            disabled={busy || queueRunning || Boolean(workflowRunningId) || financeEntryBusy}
            onOpenSettings={() => navigateToView('settings')}
            onPrepareMeeting={prepareMeeting}
            onGoogleCalendarSettingsRefresh={setGoogleCalendarSettings}
            onGoogleGmailSettingsRefresh={setGoogleGmailSettings}
            onSettingsRefresh={setGoogleTasksSettings}
            onMicrosoftTodoSettingsRefresh={setMicrosoftTodoSettings}
            onMicrosoftCalendarSettingsRefresh={setMicrosoftCalendarSettings}
            onMicrosoftMailSettingsRefresh={setMicrosoftMailSettings}
          />}
          {view === 'email' && gateStartupView(EMAIL_STARTUP_KEYS, 'connected email accounts', (
            <ConnectedEmailView
              googleGmailSettings={googleGmailSettings}
              microsoftMailSettings={microsoftMailSettings}
              disabled={busy || queueRunning || Boolean(workflowRunningId) || financeEntryBusy}
              onOpenSettings={() => navigateToView('settings')}
              onGoogleGmailSettingsRefresh={setGoogleGmailSettings}
              onMicrosoftMailSettingsRefresh={setMicrosoftMailSettings}
            />
          ))}
          {view === 'cloud_files' && gateStartupView(['drive', 'microsoftOneDrive'], 'connected file services', (
            <ConnectedFilesView
              googleDriveSettings={googleDriveSettings}
              microsoftOneDriveSettings={microsoftOneDriveSettings}
              disabled={busy || queueRunning || Boolean(workflowRunningId) || financeEntryBusy}
              onOpenSettings={() => navigateToView('settings')}
              chatDraftLength={input.trimEnd().length}
              onPrepareChat={prepareCloudFileChat}
            />
          ))}
          {view === 'scheduled' && gateStartupView(['scheduledTasks'], 'scheduled tasks', (
            <ScheduledTasksView
              tasks={scheduledTasks}
              searchTargetId={scheduledSearchTarget}
              onSearchTargetConsumed={clearScheduledSearchTarget}
              disabled={busy || queueRunning || Boolean(workflowRunningId) || financeEntryBusy}
              onCreate={createScheduledTask}
              onSetEnabled={setScheduledTaskEnabled}
              onRemove={removeScheduledTask}
              onRun={runScheduledTask}
            />
          ))}
          {view === 'coach' && <CoachView onStart={startCoachingChat} />}
          {view === 'work' && <WorkView onNavigate={setView} />}
          {view === 'integrations' && gateStartupView(INTEGRATION_STARTUP_KEYS, 'connected service settings', (
            <IntegrationsView googleCalendarSettings={googleCalendarSettings} googleGmailSettings={googleGmailSettings} googleDriveSettings={googleDriveSettings} googleTasksSettings={googleTasksSettings} microsoftTodoSettings={microsoftTodoSettings} microsoftCalendarSettings={microsoftCalendarSettings} microsoftMailSettings={microsoftMailSettings} microsoftOneDriveSettings={microsoftOneDriveSettings} notionSettings={notionSettings} githubSettings={githubSettings} onOpen={(id) => id === 'memory' ? openMemorySettings() : navigateToView(resolveIntegrationTargetView(id))} />
          ))}
          {view === 'research' && <ResearchView />}
          {view === 'vault' && <VaultView initialDocument={pendingVaultDocument} onInitialDocumentConsumed={clearPendingVaultDocument} onOpenResearch={() => setView('research')} />}
          {view === 'teaching' && <TeachingView onStart={startTeachingPack} />}

          {view === 'finances' && (
            <>
              {financeError && (
                <div className="finance-error" role="alert">
                  <span>{financeError}</span>
                  <button className="ghost-button" type="button" onClick={() => setFinanceRefresh((version) => version + 1)}>Retry</button>
                </div>
              )}
              <FinanceView
                report={financeError ? null : financeReport}
                period={financePeriod}
                loading={financeLoading}
                disabled={busy || queueRunning || Boolean(workflowRunningId) || financeEntryBusy}
                onPeriodChange={setFinancePeriod}
                onRefresh={() => setFinanceRefresh((version) => version + 1)}
                onAdd={recordFinanceTransaction}
              />
            </>
          )}

          {view === 'workflows' && gateStartupView(['workflows'], 'saved workflows', (
            <WorkflowsView
              workflows={workflows}
              searchTargetId={workflowSearchTarget}
              onSearchTargetConsumed={clearWorkflowSearchTarget}
              runningId={workflowRunningId}
              disabled={busy || queueRunning || financeEntryBusy}
              onRun={runWorkflow}
              onRemove={removeWorkflow}
              onLaunchPrompt={prepareGuidedChat}
            />
          ))}

          {view === 'skills' && gateStartupView(['skills'], 'saved skills', (
            <SkillsView
              skills={skills}
              searchTargetId={skillSearchTarget}
              onSearchTargetConsumed={clearSkillSearchTarget}
              disabled={busy || queueRunning || Boolean(workflowRunningId) || financeEntryBusy}
              onSave={saveSkill}
              onToggle={setSkillEnabled}
              onDelete={deleteSkill}
            />
          ))}

          {view === 'activity' && gateStartupView(ACTIVITY_STARTUP_KEYS, 'the activity log', (
            <ActivityView events={audit} integrity={auditIntegrity} onExport={exportAudit} />
          ))}

          {view === 'settings' && gateStartupView(SETTINGS_STARTUP_KEYS, 'saved settings', (
            <SettingsView
              section={settingsSection}
              onSectionChange={setSettingsSection}
              memoryDisabled={busy || queueRunning || Boolean(workflowRunningId) || financeEntryBusy}
              memoryVersion={memoryVersion}
              selectedMemoryFact={selectedMemoryResult?.fact ?? null}
              selectedMemoryQuery={selectedMemoryResult?.query}
              onClearSelectedMemoryFact={clearSelectedMemoryFact}
              onMemoryChanged={() => setMemoryVersion((version) => version + 1)}
              settings={settings!}
              theme={appTheme}
              onThemeChange={setAppTheme}
              webSearchSettings={webSearchSettings}
              notionSettings={notionSettings}
              githubSettings={githubSettings}
              googleCalendarSettings={googleCalendarSettings}
              googleGmailSettings={googleGmailSettings}
              googleDriveSettings={googleDriveSettings}
              googleTasksSettings={googleTasksSettings}
              microsoftTodoSettings={microsoftTodoSettings}
              microsoftCalendarSettings={microsoftCalendarSettings}
              microsoftMailSettings={microsoftMailSettings}
              microsoftOneDriveSettings={microsoftOneDriveSettings}
              grants={grants}
              onSave={saveSettings}
              onUpdateWebSearchApiKey={updateWebSearchApiKey}
              onUpdateNotionApiKey={updateNotionApiKey}
              onUpdateGitHubToken={updateGitHubToken}
              onUpdateGoogleCalendarClientId={updateGoogleCalendarClientId}
              onConnectGoogleCalendar={connectGoogleCalendar}
              onDisconnectGoogleCalendar={disconnectGoogleCalendar}
              onUpdateGoogleGmailClientId={updateGoogleGmailClientId}
              onConnectGoogleGmail={connectGoogleGmail}
              onDisconnectGoogleGmail={disconnectGoogleGmail}
              onUpdateGoogleDriveClientId={updateGoogleDriveClientId}
              onConnectGoogleDrive={connectGoogleDrive}
              onDisconnectGoogleDrive={disconnectGoogleDrive}
              onUpdateGoogleTasksClientId={updateGoogleTasksClientId}
              onConnectGoogleTasks={connectGoogleTasks}
              onDisconnectGoogleTasks={disconnectGoogleTasks}
              onUpdateMicrosoftTodoClientId={updateMicrosoftTodoClientId}
              onBeginMicrosoftTodoConnect={beginMicrosoftTodoConnect}
              onGetMicrosoftTodoConnectStatus={getMicrosoftTodoConnectStatus}
              onCancelMicrosoftTodoConnect={cancelMicrosoftTodoConnect}
              onDisconnectMicrosoftTodo={disconnectMicrosoftTodo}
              onUpdateMicrosoftCalendarClientId={updateMicrosoftCalendarClientId}
              onBeginMicrosoftCalendarConnect={beginMicrosoftCalendarConnect}
              onGetMicrosoftCalendarConnectStatus={getMicrosoftCalendarConnectStatus}
              onCancelMicrosoftCalendarConnect={cancelMicrosoftCalendarConnect}
              onDisconnectMicrosoftCalendar={disconnectMicrosoftCalendar}
              onUpdateMicrosoftMailClientId={updateMicrosoftMailClientId}
              onBeginMicrosoftMailConnect={beginMicrosoftMailConnect}
              onGetMicrosoftMailConnectStatus={getMicrosoftMailConnectStatus}
              onCancelMicrosoftMailConnect={cancelMicrosoftMailConnect}
              onDisconnectMicrosoftMail={disconnectMicrosoftMail}
              onUpdateMicrosoftOneDriveClientId={updateMicrosoftOneDriveClientId}
              onBeginMicrosoftOneDriveConnect={beginMicrosoftOneDriveConnect}
              onGetMicrosoftOneDriveConnectStatus={getMicrosoftOneDriveConnectStatus}
              onCancelMicrosoftOneDriveConnect={cancelMicrosoftOneDriveConnect}
              onDisconnectMicrosoftOneDrive={disconnectMicrosoftOneDrive}
              onTest={testProvider}
              onAddGrant={addGrant}
              onRemoveGrant={removeGrant}
              onSetGrantAccess={setGrantAccess}
              allowedDomains={allowedDomains}
              onAddDomain={addAllowedDomain}
              onRemoveDomain={removeAllowedDomain}
              onBackup={createBackup}
              onRestoreBackup={restoreBackup}
              speechEndpoint={speechEndpoint}
              onUpdateSpeechEndpoint={updateSpeechEndpoint}
              localApiStatus={localApiStatus}
              onSetLocalApiEnabled={setLocalApiEnabled}
            />
          ))}
          </Suspense>
        </div>
      </main>

      {onboardingOpen && !permission && (
        <AccessibleDialog className="modal onboarding-modal" labelledBy="onboarding-title" initialFocusRef={onboardingTitleRef}>
          <span className="modal-kicker"><span className="shield-dot" /> First-run setup</span>
          <h2 id="onboarding-title" ref={onboardingTitleRef} tabIndex={-1}>Welcome to Mike Assist</h2>
          <p className="onboarding-copy">
            Your chat history stays on this device. The model can only use approved folders;
            every write shows a preview and waits for your approval.
          </p>
          <ol className="onboarding-steps">
            <li>Choose a local model in Settings, or connect another compatible provider.</li>
            <li>Add folders you want Mike Assist to read. Use read-only access when possible.</li>
            <li>Allow web domains individually. Fetched pages are treated as untrusted data.</li>
            <li>Optional voice input uses a local transcription server you configure.</li>
            <li>Finance entries, saved workflow steps, and remembered facts stay local; writes still require approval.</li>
            <li>In chat use <code>/remember [scope] fact</code>, <code>/recall keywords</code>, or <code>/ask question</code>.</li>
          </ol>
          <div className="modal-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                navigateToView('settings')
                void completeOnboarding()
              }}
            >
              Open settings
            </button>
            <button className="btn btn-primary" type="button" onClick={() => void completeOnboarding()}>
              Start chatting
            </button>
          </div>
        </AccessibleDialog>
      )}
      {permission && <ApprovalModal key={permission.id} request={permission} onRespond={respond} />}
    </div>
  )
}
