import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type {
  AuditEvent,
  AuditIntegrity,
  ApprovalChoice,
  ChatMessage,
  ChatImageAttachmentInput,
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
  ProviderStatus
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
  PublicGoogleCalendarSettings,
  PublicGoogleGmailSettings,
  PublicGoogleDriveSettings,
  SettingsPatch,
  SettingsResult,
  WebSearchSettingsResult,
  GoogleCalendarSettingsResult,
  GoogleGmailSettingsResult,
  GoogleDriveSettingsResult
} from '../../shared/ipc'
import { presetFor } from '../../shared/presets'
import { buildWorkflowDraftFromTurn } from '../../shared/workflow-params'
import { ApprovalModal } from './components/ApprovalModal'
import { ChatView } from './components/ChatView'
import { Sidebar } from './components/Sidebar'
import { resolveIntegrationTargetView, VIEW_META, type View } from './navigation'
import { applyAppTheme, getSavedAppTheme, APP_THEME_STORAGE_KEY, type AppTheme } from './theme'
import { statusFor, type TimelineItem } from './types'

const ActivityView = lazy(() => import('./components/ActivityView').then((module) => ({ default: module.ActivityView })))
const FinanceView = lazy(() => import('./components/FinanceView').then((module) => ({ default: module.FinanceView })))
const MemoryView = lazy(() => import('./components/MemoryView').then((module) => ({ default: module.MemoryView })))
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

let localSequence = 0

function localId(): string {
  localSequence += 1
  return `local-${Date.now()}-${localSequence}`
}

function systemMessage(text: string): ChatMessage {
  return { id: localId(), role: 'system', text, at: new Date().toISOString() }
}

function speakWithLocalVoice(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const voice = window.speechSynthesis.getVoices().find((candidate) => candidate.localService)
  if (!voice) return
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 4000))
  utterance.voice = voice
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
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
  const [appTheme, setAppTheme] = useState<AppTheme>(getSavedAppTheme)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [auditIntegrity, setAuditIntegrity] = useState<AuditIntegrity>({
    valid: true,
    legacyEvents: 0,
    chainedEvents: 0
  })
  const [permission, setPermission] = useState<PermissionRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<{ index: number; max: number } | null>(null)
  const [grants, setGrants] = useState<FolderGrant[]>([])
  const [allowedDomains, setAllowedDomains] = useState<string[]>([])
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [localApiStatus, setLocalApiStatus] = useState<LocalApiStatus | null>(null)
  const [localApiActivity, setLocalApiActivity] = useState<{ summary?: string } | null>(null)
  const [webSearchSettings, setWebSearchSettings] = useState<PublicWebSearchSettings | null>(null)
  const [googleCalendarSettings, setGoogleCalendarSettings] = useState<PublicGoogleCalendarSettings | null>(null)
  const [googleGmailSettings, setGoogleGmailSettings] = useState<PublicGoogleGmailSettings | null>(null)
  const [googleDriveSettings, setGoogleDriveSettings] = useState<PublicGoogleDriveSettings | null>(null)
  const [speechEndpoint, setSpeechEndpoint] = useState('')
  const [onboardingOpen, setOnboardingOpen] = useState(false)
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
      return saved === 'brainstorm' || saved === 'software' || saved === 'review' || saved === 'coach_personal' || saved === 'coach_business'
        ? saved
        : 'assistant'
    } catch {
      return 'assistant'
    }
  })
  const [financePeriod, setFinancePeriod] = useState<'week' | 'month'>('month')
  const [financeReport, setFinanceReport] = useState<FinanceReport | null>(null)
  const [financeLoading, setFinanceLoading] = useState(false)
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
  const busyRef = useRef(false)
  const queuedTasksRef = useRef<string[]>([])
  const queueRunningRef = useRef(false)
  const queueCompletionRef = useRef<(() => void) | null>(null)
  const directWorkflowRunningRef = useRef(false)
  const toolNamesByCallId = useRef(new Map<string, string>())
  const voiceChatRef = useRef(voiceChatEnabled)
  const chatModeRef = useRef<ChatMode>(chatMode)

  useEffect(() => {
    applyAppTheme(document.documentElement, appTheme)
    try {
      localStorage.setItem(APP_THEME_STORAGE_KEY, appTheme)
    } catch {
      // The selected theme remains active for this renderer session.
    }
  }, [appTheme])

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
    let alive = true

    void window.assist.getAudit().then((events) => {
      if (alive) setAudit(events)
    })
    void window.assist.getAuditIntegrity().then((integrity) => {
      if (alive) setAuditIntegrity(integrity)
    })
    void window.assist.getChatState().then((result) => {
      if (alive && result.ok && result.state) {
        setSessions(result.state.sessions)
        setActiveSessionId(result.state.activeSessionId)
        setTimeline(timelineFor(result.state.messages))
      }
    })
    void window.assist.getGrants().then((list) => {
      if (alive) setGrants(list)
    })
    void window.assist.getAllowedDomains().then((domains) => {
      if (alive) setAllowedDomains(domains)
    })
    void window.assist.getSettings().then((value) => {
      if (alive) {
        setSettings(value)
        setOnboardingOpen(!value.onboardingComplete)
      }
    })
    void window.assist.getLocalApiStatus().then((value) => {
      if (alive) setLocalApiStatus(value)
    })
    void window.assist.getWebSearchSettings().then((value) => {
      if (alive) setWebSearchSettings(value)
    })
    void window.assist.getGoogleCalendarSettings().then((value) => {
      if (alive) setGoogleCalendarSettings(value)
    })
    void window.assist.getGoogleGmailSettings().then((value) => {
      if (alive) setGoogleGmailSettings(value)
    })
    void window.assist.getGoogleDriveSettings().then((value) => {
      if (alive) setGoogleDriveSettings(value)
    })
    void window.assist.getSpeechEndpoint().then((endpoint) => {
      if (alive) setSpeechEndpoint(endpoint)
    })
    void window.assist.getWorkflows().then((list) => {
      if (alive) setWorkflows(list)
    })
    void window.assist.getScheduledTasks().then((list) => {
      if (alive) setScheduledTasks(list)
    })
    void window.assist.getSkills().then((list) => {
      if (alive) setSkills(list)
    })

    return () => {
      alive = false
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
            void window.assist.getScheduledTasks().then(setScheduledTasks)
          }
          if (resultTool === 'save_skill' && event.result.ok) {
            void window.assist.getSkills().then(setSkills)
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

        case 'busy':
          busyRef.current = event.busy
          setBusy(event.busy)
          if (!event.busy) {
            queueCompletionRef.current?.()
            queueCompletionRef.current = null
            setStep(null)
            void window.assist.getChatState().then((result) => {
              if (result.ok && result.state) setSessions(result.state.sessions)
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
          void window.assist.getScheduledTasks().then(setScheduledTasks)
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
      attachments?: ChatImageAttachmentInput[]
    ): Promise<boolean> => {
      const value = (text ?? input).trim()
      if ((!value && !attachments?.length) || busy || queueRunning || directWorkflowRunningRef.current) return false

      busyRef.current = true
      setBusy(true)
      setInput('')

      try {
        const result = await window.assist.sendMessage(value, modeOverride ?? chatMode, attachments)
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
    [busy, input, queueRunning, chatMode]
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
    async (text?: string, attachments?: ChatImageAttachmentInput[]): Promise<boolean> => {
      const value = (text ?? input).trim()
      if (!value && !attachments?.length) return false

      const command = attachments?.length ? null : /^\/(remember|recall|ask)(\s|$)/.exec(value)
      if (command) {
        await runCommand(value)
        setInput('')
        return true
      }
      return sendAgentMessage(value, undefined, attachments)
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
          const result = await window.assist.sendMessage(task, chatModeRef.current)
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
    void window.assist.cancel()
  }, [])

  const toggleVoiceChat = useCallback(() => {
    setVoiceChatEnabled((enabled) => !enabled)
  }, [])

  const changeChat = useCallback(async (sessionId?: string): Promise<void> => {
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
      setChatMode('assistant')
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

  useEffect(() => {
    const q = sessionSearch.trim()
    if (!q) {
      setFilteredSessions(null)
      return
    }
    let cancelled = false
    void window.assist.searchChats(q, chatMode).then((matches) => {
      if (!cancelled) setFilteredSessions(matches)
    })
    return () => {
      cancelled = true
    }
  }, [sessionSearch, chatMode, sessions])

  const renameActiveChat = useCallback(async (): Promise<void> => {
    if (!activeSessionId || !renameDraft.trim()) return
    const result = await window.assist.renameChat(activeSessionId, renameDraft.trim())
    if (result.ok && result.state) {
      setSessions(result.state.sessions)
      setRenamingSession(false)
    }
  }, [activeSessionId, renameDraft])

  const deleteActiveChat = useCallback(async (): Promise<void> => {
    if (!activeSessionId || busy || queueRunning || workflowRunningId) return
    const result = await window.assist.deleteChat(activeSessionId)
    if (result.ok && result.state) {
      streaming.current.clear()
      setSessions(result.state.sessions)
      setActiveSessionId(result.state.activeSessionId)
      setTimeline(timelineFor(result.state.messages))
      setPermission(null)
      setRenamingSession(false)
    }
  }, [activeSessionId, busy, queueRunning, workflowRunningId])

  const exportActiveChat = useCallback(async (): Promise<void> => {
    if (!activeSessionId) return
    const result = await window.assist.exportChat(activeSessionId)
    if (result.ok && result.fileName) {
      pushSystemMessage(`Exported conversation to ${result.fileName}.`)
    } else if (!result.cancelled && result.error) {
      pushSystemMessage(result.error)
    }
  }, [activeSessionId, pushSystemMessage])

  const deleteMessageFromActiveChat = useCallback(async (messageId: string): Promise<void> => {
    if (!activeSessionId || busy || queueRunning || workflowRunningId) return
    const result = await window.assist.deleteChatMessage(activeSessionId, messageId)
    if (result.ok && result.state) {
      setTimeline(timelineFor(result.state.messages))
    }
  }, [activeSessionId, busy, queueRunning, workflowRunningId])

  const respond = useCallback(
    (choice: ApprovalChoice) => {
      const request = permission
      if (!request) return

      setPermission(null)
      void window.assist.respondPermission(request.id, choice).catch((error: unknown) => {
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
      void window.assist.getSettings().then(setSettings)
      void window.assist.getAllowedDomains().then(setAllowedDomains)
      void window.assist.getSpeechEndpoint().then(setSpeechEndpoint)
      void window.assist.getWorkflows().then(setWorkflows)
      void window.assist.getScheduledTasks().then(setScheduledTasks)
      void window.assist.getSkills().then(setSkills)
      void window.assist.getAudit().then(setAudit)
      void window.assist.getAuditIntegrity().then(setAuditIntegrity)
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

  const preset = settings ? presetFor(settings.provider.preset) : null

  return (
    <div className="app">
      <Sidebar
        view={view}
        onChange={setView}
        auditCount={audit.length}
        grants={grants}
        model={settings?.provider.model ?? ''}
        preset={preset?.label ?? ''}
      />

      <main className="main">
        <header className="topbar">
          <div className="topbar-titles">
            <h1>{VIEW_META[view].label}</h1>
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
                <input
                  type="search"
                  className="session-search-input"
                  value={sessionSearch}
                  onChange={(event) => setSessionSearch(event.target.value)}
                  placeholder="Search chats…"
                  aria-label="Search conversations"
                />
                {renamingSession ? (
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
                  <select
                    value={activeSessionId}
                    disabled={busy || queueRunning || Boolean(workflowRunningId) || sessions.length === 0}
                    aria-label="Conversation history"
                    onChange={(event) => void changeChat(event.target.value)}
                  >
                    {(filteredSessions ?? sessions).map((session) => (
                      <option key={session.id} value={session.id}>{session.title}</option>
                    ))}
                  </select>
                )}
                <select
                  className="chat-mode-select"
                  value={chatMode}
                  disabled={busy || queueRunning || Boolean(workflowRunningId)}
                  aria-label="Assistant mode"
                  onChange={(event) => setChatMode(event.target.value as ChatMode)}
                >
                  <option value="assistant">Assistant</option>
                  <option value="brainstorm">Brainstorm</option>
                  <option value="software">Software</option>
                  <option value="review">Project review</option>
                  {chatMode === 'coach_personal' && <option value="coach_personal">Personal coach</option>}
                  {chatMode === 'coach_business' && <option value="coach_business">Business coach</option>}
                </select>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={busy || queueRunning || Boolean(workflowRunningId) || !activeSessionId}
                  onClick={() => {
                    const current = sessions.find((s) => s.id === activeSessionId)
                    setRenameDraft(current?.title ?? '')
                    setRenamingSession(true)
                  }}
                >
                  Rename
                </button>
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
                  disabled={busy || queueRunning || Boolean(workflowRunningId) || !activeSessionId}
                  onClick={() => void deleteActiveChat()}
                >
                  Delete
                </button>
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
            <span className="model-badge">
              <span className="pulse" />
              {settings ? settings.provider.model : 'Loading…'}
            </span>
          </div>
        </header>

        <div className="content">
          <Suspense fallback={<div className="view-loading" role="status">Loading section…</div>}>
          {view === 'chat' && (
            <ChatView
              items={timeline}
              chatMode={chatMode}
              busy={busy || queueRunning || Boolean(workflowRunningId)}
              input={input}
              onInputChange={setInput}
              onSend={send}
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
              endRef={endRef}
              onDeleteMessage={(messageId) => void deleteMessageFromActiveChat(messageId)}
              onCitationClick={() => setView('memory')}
            />
          )}

          {view === 'today' && <TodayView />}
          {view === 'scheduled' && (
            <ScheduledTasksView
              tasks={scheduledTasks}
              disabled={busy || queueRunning || Boolean(workflowRunningId) || financeEntryBusy}
              onCreate={createScheduledTask}
              onSetEnabled={setScheduledTaskEnabled}
              onRemove={removeScheduledTask}
              onRun={runScheduledTask}
            />
          )}
          {view === 'coach' && <CoachView onStart={startCoachingChat} />}
          {view === 'integrations' && <IntegrationsView googleCalendarSettings={googleCalendarSettings} googleGmailSettings={googleGmailSettings} googleDriveSettings={googleDriveSettings} onOpen={(id) => setView(resolveIntegrationTargetView(id))} />}
          {view === 'research' && <ResearchView />}
          {view === 'vault' && <VaultView />}
          {view === 'teaching' && <TeachingView onStart={startTeachingPack} />}

          {view === 'finances' && (
            <>
              {financeError && <div className="finance-error" role="alert">{financeError}</div>}
              <FinanceView
                report={financeReport}
                period={financePeriod}
                loading={financeLoading}
                disabled={busy || queueRunning || Boolean(workflowRunningId) || financeEntryBusy}
                onPeriodChange={setFinancePeriod}
                onAdd={recordFinanceTransaction}
              />
            </>
          )}

          {view === 'workflows' && (
            <WorkflowsView
              workflows={workflows}
              runningId={workflowRunningId}
              disabled={busy || queueRunning || financeEntryBusy}
              onRun={runWorkflow}
              onRemove={removeWorkflow}
              onCancel={cancel}
            />
          )}

          {view === 'skills' && (
            <SkillsView
              skills={skills}
              disabled={busy || queueRunning || Boolean(workflowRunningId) || financeEntryBusy}
              onSave={saveSkill}
              onToggle={setSkillEnabled}
              onDelete={deleteSkill}
            />
          )}

          {view === 'memory' && (
            <MemoryView
              disabled={busy || queueRunning || Boolean(workflowRunningId) || financeEntryBusy}
              version={memoryVersion}
              onChanged={() => setMemoryVersion((version) => version + 1)}
            />
          )}

          {view === 'activity' && (
            <ActivityView events={audit} integrity={auditIntegrity} onExport={exportAudit} />
          )}

          {view === 'settings' && settings && (
            <SettingsView
              settings={settings}
              theme={appTheme}
              onThemeChange={setAppTheme}
              webSearchSettings={webSearchSettings}
              googleCalendarSettings={googleCalendarSettings}
              googleGmailSettings={googleGmailSettings}
              googleDriveSettings={googleDriveSettings}
              grants={grants}
              onSave={saveSettings}
              onUpdateWebSearchApiKey={updateWebSearchApiKey}
              onUpdateGoogleCalendarClientId={updateGoogleCalendarClientId}
              onConnectGoogleCalendar={connectGoogleCalendar}
              onDisconnectGoogleCalendar={disconnectGoogleCalendar}
              onUpdateGoogleGmailClientId={updateGoogleGmailClientId}
              onConnectGoogleGmail={connectGoogleGmail}
              onDisconnectGoogleGmail={disconnectGoogleGmail}
              onUpdateGoogleDriveClientId={updateGoogleDriveClientId}
              onConnectGoogleDrive={connectGoogleDrive}
              onDisconnectGoogleDrive={disconnectGoogleDrive}
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
          )}

          {view === 'settings' && !settings && (
            <div className="audit-empty">
              <div className="audit-empty-mark">◇</div>
              <p>Loading settings…</p>
            </div>
          )}
          </Suspense>
        </div>
      </main>

      {onboardingOpen && (
        <div className="modal-backdrop onboarding-backdrop">
          <section
            className="modal onboarding-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
          >
            <span className="modal-kicker"><span className="shield-dot" /> First-run setup</span>
            <h2 id="onboarding-title">Welcome to Mike Assist</h2>
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
                  setView('settings')
                  void completeOnboarding()
                }}
              >
                Open settings
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void completeOnboarding()}>
                Start chatting
              </button>
            </div>
          </section>
        </div>
      )}
      {permission && <ApprovalModal request={permission} onRespond={respond} />}
    </div>
  )
}
