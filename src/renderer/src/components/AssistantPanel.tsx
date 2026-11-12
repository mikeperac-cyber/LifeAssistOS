import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantChatMessage, AssistantLearningLevel, AssistantMode } from '../../../shared/assistant'
import { Icon } from './Icon'
import { clearCapturedReply, EMPTY_CAPTURED_REPLY_KEYS, isReplyCaptured, markReplyCaptured } from './assistant-ui-model'

const MODES: Array<{ id: AssistantMode; label: string; icon: 'sparkles' | 'teacher' | 'assistant'; prompts: string[] }> = [
  { id: 'coach', label: 'Coach', icon: 'sparkles', prompts: ['Help me sort through a decision', 'I feel overwhelmed—help me find one small step'] },
  { id: 'teacher', label: 'Teacher', icon: 'teacher', prompts: ['Teach me something step by step', 'Give me a short practice question'] },
  { id: 'assistant', label: 'Assistant', icon: 'assistant', prompts: ['Help me organize my thoughts', 'Make a plan for my next step'] }
]

const FOLLOW_UPS: Record<AssistantMode, string[]> = {
  coach: ['Help me choose one realistic next step', 'Ask me a question to help me reflect'],
  teacher: ['Give me one practice question about this', 'Explain that more simply with an example'],
  assistant: ['Turn this into a short checklist', 'Make the next action more specific']
}

export function AssistantPanel({ providerReady, lifeContextAvailable = { goals: false, journal: false, personalContext: false }, initialPrompt = '', onInitialPromptConsumed = () => undefined, onOpenSettings, compactHeader = false }: {
  providerReady: boolean
  lifeContextAvailable?: { goals: boolean; journal: boolean; personalContext: boolean }
  initialPrompt?: string
  onInitialPromptConsumed?: () => void
  onOpenSettings: () => void
  compactHeader?: boolean
}): React.JSX.Element {
  const [mode, setMode] = useState<AssistantMode>('coach')
  const [learningLevel, setLearningLevel] = useState<AssistantLearningLevel>('adaptive')
  const [conversations, setConversations] = useState<Record<AssistantMode, AssistantChatMessage[]>>({ coach: [], teacher: [], assistant: [] })
  const [draft, setDraft] = useState('')
  const [includeTasks, setIncludeTasks] = useState(false)
  const [includeGoals, setIncludeGoals] = useState(false)
  const [includeJournal, setIncludeJournal] = useState(false)
  const [includePersonalContext, setIncludePersonalContext] = useState(false)
  const [pending, setPending] = useState(false)
  const [savingReply, setSavingReply] = useState(false)
  const [capturedReplyKeys, setCapturedReplyKeys] = useState(EMPTY_CAPTURED_REPLY_KEYS)
  const [captureMessage, setCaptureMessage] = useState('')
  const [error, setError] = useState('')
  const activeRequestId = useRef<string | null>(null)
  const messages = conversations[mode]
  const currentMode = useMemo(() => MODES.find((item) => item.id === mode)!, [mode])
  const latestMessage = messages.at(-1)
  const latestReply = latestMessage?.role === 'assistant' ? latestMessage : null
  const latestReplyKey = latestReply ? `${mode}:${messages.length}:${latestReply.content}` : ''

  useEffect(() => {
    if (!initialPrompt.trim() || !providerReady) return
    setMode('coach')
    setDraft(initialPrompt)
    onInitialPromptConsumed()
  }, [initialPrompt, onInitialPromptConsumed, providerReady])

  useEffect(() => () => {
    const requestId = activeRequestId.current
    if (requestId) void window.assist.cancelAssistantChat(requestId)
  }, [])

  async function send(message = draft): Promise<void> {
    const content = message.trim()
    if (!providerReady || pending || !content || content.length > 3_000) return
    const nextMessages = [...messages.slice(-6), { role: 'user' as const, content }]
    setConversations((current) => ({ ...current, [mode]: nextMessages }))
    setDraft('')
    setError('')
    setCaptureMessage('')
    setPending(true)
    const requestId = crypto.randomUUID()
    activeRequestId.current = requestId
    let streaming = true
    let unsubscribe = (): void => undefined
    try {
      unsubscribe = window.assist.onAssistantDelta((delta) => {
        if (!streaming || delta.requestId !== requestId || !delta.text) return
        setConversations((current) => {
          const thread = current[mode]
          const last = thread.at(-1)
          const updatedThread = last?.role === 'assistant'
            ? [...thread.slice(0, -1), { role: 'assistant' as const, content: last.content + delta.text }]
            : [...thread, { role: 'assistant' as const, content: delta.text }]
          return { ...current, [mode]: updatedThread }
        })
      })
      const result = await window.assist.assistantChat({
        requestId,
        mode,
        messages: nextMessages,
        includeTasks,
        includeGoals: includeGoals && lifeContextAvailable.goals,
        includeJournal: includeJournal && lifeContextAvailable.journal,
        includePersonalContext: includePersonalContext && lifeContextAvailable.personalContext,
        learningLevel,
        localDate: getLocalDate(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      })
      if (!result.ok) throw new Error(result.error)
      streaming = false
      unsubscribe()
      setConversations((current) => ({ ...current, [mode]: [...nextMessages, { role: 'assistant', content: result.reply }] }))
    } catch (cause) {
      streaming = false
      unsubscribe()
      setConversations((current) => current[mode].length > nextMessages.length
        ? { ...current, [mode]: current[mode].slice(0, nextMessages.length) }
        : current)
      setError(cause instanceof Error ? cause.message : 'The assistant could not respond. Try again.')
    } finally {
      streaming = false
      unsubscribe()
      if (activeRequestId.current === requestId) activeRequestId.current = null
      setPending(false)
    }
  }

  async function stopResponse(): Promise<void> {
    const requestId = activeRequestId.current
    if (!requestId) return
    try { await window.assist.cancelAssistantChat(requestId) }
    catch { setError('Could not stop the response. It will finish or time out on its own.') }
  }

  async function saveReplyToInbox(): Promise<void> {
    if (!latestReply || isReplyCaptured(capturedReplyKeys, mode, latestReplyKey) || savingReply) return
    if (latestReply.content.trim().length > 2_000) {
      setCaptureMessage('This reply is longer than the Inbox limit of 2,000 characters.')
      return
    }
    setSavingReply(true)
    setCaptureMessage('')
    try {
      const result = await window.assist.captureInbox(latestReply.content)
      if (!result.ok) throw new Error(result.error ?? 'This reply could not be saved to the Inbox.')
      setCapturedReplyKeys((current) => markReplyCaptured(current, mode, latestReplyKey))
      setCaptureMessage('Saved to your Inbox for review.')
    } catch (cause) {
      setCaptureMessage(cause instanceof Error ? cause.message : 'This reply could not be saved to the Inbox.')
    } finally {
      setSavingReply(false)
    }
  }

  return (
    <aside className="assistant-panel" aria-label="AI assistant">
      {!compactHeader && <div className="assistant-panel-heading">
        <span className="assistant-panel-mark"><Icon name={currentMode.icon} /></span>
        <div><h3>Ask your {mode === 'coach' ? 'coach' : mode === 'teacher' ? 'teacher' : 'assistant'}</h3><p>Support for your next step</p></div>
        {messages.length > 0 && <button className="assistant-clear" type="button" aria-label="Clear this conversation" title="Clear conversation" disabled={pending || savingReply} onClick={() => { setConversations((current) => ({ ...current, [mode]: [] })); setCapturedReplyKeys((current) => clearCapturedReply(current, mode)); setCaptureMessage('') }}><Icon name="close" /></button>}
      </div>}

      <div className={`assistant-mode-tabs${compactHeader ? ' standalone' : ''}`} role="group" aria-label="Assistant mode">
        {MODES.map((item) => <button key={item.id} type="button" aria-pressed={mode === item.id} disabled={pending || savingReply} className={mode === item.id ? 'active' : ''} onClick={() => { setMode(item.id); setError(''); setCaptureMessage('') }}><Icon name={item.icon} /><span>{item.label}</span></button>)}
        {compactHeader && messages.length > 0 && <button className="assistant-clear" type="button" aria-label="Clear this conversation" title="Clear conversation" disabled={pending || savingReply} onClick={() => { setConversations((current) => ({ ...current, [mode]: [] })); setCapturedReplyKeys((current) => clearCapturedReply(current, mode)); setCaptureMessage('') }}><Icon name="close" /></button>}
      </div>

      {mode === 'teacher' && <label className="assistant-learning-level">
        <span>Explain at</span>
        <select value={learningLevel} onChange={(event) => setLearningLevel(event.target.value as AssistantLearningLevel)} disabled={pending}>
          <option value="adaptive">Adapt to me</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </label>}

      {!providerReady && <div className="assistant-connect">
        <span className="assistant-connect-mark"><Icon name="sparkles" /></span>
        <h3>Choose an AI provider to begin</h3>
        <p>Sign in to OpenRouter, add an API key from a hosted provider, or connect a local model.</p>
        <button className="primary-button" type="button" onClick={onOpenSettings}>Choose provider</button>
      </div>}
      {providerReady && <>
        <div className="assistant-conversation" aria-live={pending ? 'off' : 'polite'} aria-label={`${currentMode.label} conversation`}>
          {messages.length === 0 && <div className="assistant-welcome"><Icon name={currentMode.icon} /><p>{mode === 'coach' ? 'What would make today feel like a good day?' : mode === 'teacher' ? 'What would you like to understand or practice?' : 'What can I help you sort out?'}</p></div>}
          {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`assistant-message ${message.role}`}><span>{message.role === 'user' ? 'You' : currentMode.label}</span><p>{message.content}</p></div>)}
          {pending && <div className="assistant-typing" role="status"><span className="assistant-pulse" />Thinking…</div>}
          {messages.at(-1)?.role === 'assistant' && !pending && <div className="assistant-followups" aria-label={`${currentMode.label} follow-up ideas`}>
            <span>Continue with</span>
            {FOLLOW_UPS[mode].map((prompt) => <button type="button" key={prompt} disabled={pending} onClick={() => void send(prompt)}>{prompt}</button>)}
          </div>}
        </div>
        {latestReply && <div className="assistant-reply-save">
          <button type="button" disabled={savingReply || isReplyCaptured(capturedReplyKeys, mode, latestReplyKey) || latestReply.content.trim().length > 2_000} onClick={() => void saveReplyToInbox()}>
            {savingReply ? 'Saving…' : isReplyCaptured(capturedReplyKeys, mode, latestReplyKey) ? 'Saved to Inbox' : 'Save reply to Inbox'}
          </button>
          <span className={captureMessage && !isReplyCaptured(capturedReplyKeys, mode, latestReplyKey) ? 'is-error' : ''} role={captureMessage && !isReplyCaptured(capturedReplyKeys, mode, latestReplyKey) ? 'alert' : 'status'}>
            {captureMessage || (latestReply.content.trim().length > 2_000 ? 'Replies over 2,000 characters can’t be saved as one Inbox thought.' : 'Keep a useful idea nearby; review it in Inbox before turning it into a task.')}
          </span>
        </div>}
        {messages.length === 0 && <div className="assistant-prompts"><span>Try asking</span>{currentMode.prompts.map((prompt) => <button type="button" key={prompt} disabled={!providerReady || pending} onClick={() => void send(prompt)}>{prompt}<span aria-hidden="true">›</span></button>)}</div>}
        {error && <p className="assistant-error" role={error === 'Response stopped.' ? 'status' : 'alert'}>{error}</p>}
        <div className="assistant-context-options">
          <label className="assistant-share-tasks"><input type="checkbox" checked={includeTasks} disabled={pending} onChange={(event) => setIncludeTasks(event.target.checked)} /><span>Include my open tasks</span></label>
          <details className="assistant-context-details">
            <summary>More context</summary>
            <label><input type="checkbox" checked={includeGoals} disabled={pending || !lifeContextAvailable.goals} onChange={(event) => setIncludeGoals(event.target.checked)} /><span>Share my active goals</span>{!lifeContextAvailable.goals && <small>Add a goal in Life to enable this.</small>}</label>
            <label><input type="checkbox" checked={includeJournal} disabled={pending || !lifeContextAvailable.journal} onChange={(event) => setIncludeJournal(event.target.checked)} /><span>Share recent journal notes</span>{!lifeContextAvailable.journal && <small>Saved notes will appear here.</small>}</label>
            <label><input type="checkbox" checked={includePersonalContext} disabled={pending || !lifeContextAvailable.personalContext} onChange={(event) => setIncludePersonalContext(event.target.checked)} /><span>Share my personal context</span>{!lifeContextAvailable.personalContext && <small>Add this in Life → AI context.</small>}</label>
          </details>
        </div>
        {(includeTasks || includeGoals || includeJournal || includePersonalContext) && <p className="assistant-context-note">Selected context will be sent with this message to your chosen provider.</p>}
        <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
          <label className="sr-only" htmlFor="assistant-message">Message your {currentMode.label.toLowerCase()}</label>
          <textarea id="assistant-message" rows={2} maxLength={3_000} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send() } }} placeholder={`Message your ${currentMode.label.toLowerCase()}…`} disabled={!providerReady || pending} />
          {pending
            ? <button className="assistant-stop" type="button" aria-label="Stop response" onClick={() => void stopResponse()}><Icon name="stop" /></button>
            : <button type="submit" aria-label="Send message" disabled={!draft.trim()}><Icon name="send" /></button>}
        </form>
        <p className="assistant-privacy">Conversations stay in memory while Mike Assist runs and clear when you quit. Only selected context is sent to your chosen provider.</p>
      </>}
    </aside>
  )
}

function getLocalDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
