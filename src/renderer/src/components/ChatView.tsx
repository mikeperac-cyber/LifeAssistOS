import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  CHAT_IMAGE_MIME_TYPES,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_TOTAL_BYTES,
  type ChatEffort,
  type ChatImageAttachment,
  type ChatImageAttachmentInput,
  type ChatMessage,
  type ChatMode,
  type ProviderStatus
} from '../../../shared/types'
import type { PublicSettings, SettingsPatch, SettingsResult, SpeechResult, WorkflowMutationResult } from '../../../shared/ipc'
import type { WorkflowStep } from '../../../shared/types'
import { PROVIDER_PRESETS, presetFor } from '../../../shared/presets'
import type { TimelineItem } from '../types'
import { buildSkillLearningRequest } from '../skill-learning'
import { canSubmitComposer } from './chat-composer'
import { MarkdownMessage } from './MarkdownMessage'
import { ToolCardView } from './ToolCardView'

export interface ChatViewProps {
  items: TimelineItem[]
  chatMode: ChatMode
  onChatModeChange: (mode: ChatMode) => void
  chatEffort: ChatEffort
  onChatEffortChange: (effort: ChatEffort) => void
  busy: boolean
  input: string
  onInputChange: (value: string) => void
  onSend: (text?: string, attachments?: ChatImageAttachmentInput[], effort?: ChatEffort) => Promise<boolean>
  onCancel: () => void
  speechEndpoint: string
  onTranscribe: (audio: Uint8Array, mimeType: string) => Promise<SpeechResult>
  voiceChatEnabled: boolean
  onToggleVoiceChat: () => void
  queuedTasks: string[]
  queueRunning: boolean
  onQueueTask: () => void
  onRemoveQueuedTask: (index: number) => void
  onRunQueue: () => void
  workflowCandidate: { prompt: string; steps: WorkflowStep[] } | null
  onSaveWorkflow: (name: string) => Promise<WorkflowMutationResult>
  providerEndpoint: string
  providerSetupRequired: boolean
  providerSettings: PublicSettings['provider'] | null
  onUpdateProvider: (patch: SettingsPatch) => Promise<SettingsResult>
  onRefreshModels: () => Promise<ProviderStatus>
  onOpenSettings: () => void
  endRef: RefObject<HTMLDivElement | null>
  onDeleteMessage?: (messageId: string) => void
  onCitationClick?: (label: string) => void
}

interface PendingImage {
  file: File
  mimeType: ChatImageAttachment['mimeType']
  previewUrl: string
}

type SuggestionIconName = 'folder' | 'idea' | 'review' | 'code'

const SUGGESTIONS: Array<{ label: string; prompt: string; icon: SuggestionIconName }> = [
  { label: 'List my workspace', prompt: 'List the files in my workspace', icon: 'folder' },
  {
    label: 'Brainstorm ideas',
    prompt: 'I want a brainstorm partner. Ask me what goal I am working on, then help me explore diverse ideas and trade-offs.',
    icon: 'idea'
  },
  {
    label: 'Review my project',
    prompt: 'Check my approved project folder for bugs, security issues, and missing tests. Use project_overview, read the README, manifests, and key source files. Do not modify anything; report prioritized actionable findings with file paths. If it is unclear which approved folder is the project, ask me first.',
    icon: 'review'
  },
  {
    label: 'Create software',
    prompt: 'Help me create a software project. First ask about its purpose, users, target platform, and constraints. Then propose a file plan; do not modify files until I approve each change.',
    icon: 'code'
  }
]

export function ChatView({
  items,
  chatMode,
  onChatModeChange,
  chatEffort,
  onChatEffortChange,
  busy,
  input,
  onInputChange,
  onSend,
  onCancel,
  speechEndpoint,
  onTranscribe,
  voiceChatEnabled,
  onToggleVoiceChat,
  queuedTasks,
  queueRunning,
  onQueueTask,
  onRemoveQueuedTask,
  onRunQueue,
  workflowCandidate,
  onSaveWorkflow,
  providerEndpoint,
  providerSetupRequired,
  providerSettings,
  onUpdateProvider,
  onRefreshModels,
  onOpenSettings,
  endRef,
  onDeleteMessage,
  onCitationClick
}: ChatViewProps): React.JSX.Element {
  const conversationHasImages = items.some(
    (item) => item.kind === 'message' && Boolean(item.message.attachments?.length)
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const voiceModeMenuRef = useRef<HTMLDetailsElement>(null)
  const previewUrlsRef = useRef(new Set<string>())
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordedBytesRef = useRef(0)
  const voiceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [voiceMessage, setVoiceMessage] = useState('')
  const [workflowName, setWorkflowName] = useState('')
  const [workflowSaveOpen, setWorkflowSaveOpen] = useState(false)
  const [workflowSaving, setWorkflowSaving] = useState(false)
  const [workflowSaveMessage, setWorkflowSaveMessage] = useState('')
  const [skillLearningMessage, setSkillLearningMessage] = useState('')
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [preparingAttachments, setPreparingAttachments] = useState(false)
  const [providerUpdating, setProviderUpdating] = useState(false)
  const [providerError, setProviderError] = useState('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [modelMessage, setModelMessage] = useState('')
  const providerKey = providerSettings ? `${providerSettings.preset}|${providerSettings.baseUrl}` : ''
  const providerKeyRef = useRef(providerKey)

  useEffect(() => {
    providerKeyRef.current = providerKey
    setAvailableModels([])
    setModelsLoading(false)
    setModelsLoaded(false)
    setModelMessage('')
    setProviderError('')
  }, [providerKey])

  async function refreshModels(): Promise<void> {
    if (modelsLoading) return
    if (!providerKey) return
    if (providerSetupRequired) {
      setModelMessage('Add this provider’s API key in Settings to load its models.')
      setModelsLoaded(true)
      return
    }

    const requestedProvider = providerKey
    setModelsLoading(true)
    setModelMessage('')
    try {
      const result = await onRefreshModels()
      if (providerKeyRef.current !== requestedProvider) return
      if (!result.ok) {
        setModelMessage(result.message || 'Could not load models. Check the provider settings and try again.')
      } else {
        const models = [...new Set((result.models ?? []).map((model) => model.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
        setAvailableModels(models)
        if (models.length === 0) setModelMessage('This provider did not return a model list.')
      }
    } catch (error) {
      if (providerKeyRef.current === requestedProvider) {
        setModelMessage(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (providerKeyRef.current === requestedProvider) {
        setModelsLoading(false)
        setModelsLoaded(true)
      }
    }
  }

  async function saveProviderPatch(patch: SettingsPatch): Promise<void> {
    if (providerUpdating) return
    setProviderUpdating(true)
    setProviderError('')
    try {
      const result = await onUpdateProvider(patch)
      if (!result.ok) setProviderError(result.error || 'Could not save provider settings.')
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : String(error))
    } finally {
      setProviderUpdating(false)
    }
  }

  async function chooseProvider(value: string): Promise<void> {
    if (!providerSettings || providerUpdating) return
    const selected = presetFor(value as typeof providerSettings.preset)
    const model = selected.model || providerSettings.model.trim() || 'qwen2.5:3b'
    await saveProviderPatch({ preset: selected.id, baseUrl: selected.baseUrl, model })
  }

  const modelOptions = [...new Set([...(providerSettings?.model ? [providerSettings.model] : []), ...availableModels])]

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }, [input])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => () => {
    if (voiceTimeoutRef.current) clearTimeout(voiceTimeoutRef.current)
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  useEffect(() => () => {
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url)
  }, [])

  function addImages(files: FileList | null): void {
    const incoming = Array.from(files ?? [])
    if (incoming.length === 0) return
    if (pendingImages.length + incoming.length > MAX_CHAT_IMAGE_ATTACHMENTS) {
      setAttachmentError(`Attach up to ${MAX_CHAT_IMAGE_ATTACHMENTS} images per message.`)
      return
    }

    const prepared = incoming.map((file) => ({ file, mimeType: mimeTypeForImage(file) }))
    const unsupported = prepared.find((entry) => !entry.mimeType)
    if (unsupported) {
      setAttachmentError(`${unsupported.file.name || 'This file'} is not PNG, JPEG, or WebP.`)
      return
    }
    const tooLarge = prepared.find((entry) => entry.file.size <= 0 || entry.file.size > MAX_CHAT_IMAGE_BYTES)
    if (tooLarge) {
      setAttachmentError(`${tooLarge.file.name || 'This image'} must be smaller than 8 MB.`)
      return
    }
    const totalBytes = [...pendingImages.map((entry) => entry.file.size), ...prepared.map((entry) => entry.file.size)]
      .reduce((total, size) => total + size, 0)
    if (totalBytes > MAX_CHAT_IMAGE_TOTAL_BYTES) {
      setAttachmentError('Images in one message must total 16 MB or less.')
      return
    }

    const next = prepared.map(({ file, mimeType }) => {
      const previewUrl = URL.createObjectURL(file)
      previewUrlsRef.current.add(previewUrl)
      return { file, mimeType: mimeType!, previewUrl }
    })
    setPendingImages((previous) => [...previous, ...next])
    setAttachmentError('')
  }

  function removeImage(previewUrl: string): void {
    URL.revokeObjectURL(previewUrl)
    previewUrlsRef.current.delete(previewUrl)
    setPendingImages((previous) => previous.filter((image) => image.previewUrl !== previewUrl))
    setAttachmentError('')
  }

  async function submitMessage(text = input): Promise<void> {
    const trimmed = text.trim()
    if (providerSetupRequired || busy || preparingAttachments || (!trimmed && pendingImages.length === 0)) return
    setAttachmentError('')
    setPreparingAttachments(true)
    try {
      const attachments = await Promise.all(pendingImages.map(async ({ file, mimeType }) => ({
        name: file.name || 'image',
        mimeType,
        data: await fileToBase64(file)
      })))
      const accepted = await onSend(trimmed, attachments, chatEffort)
      if (!accepted) return
      for (const image of pendingImages) {
        URL.revokeObjectURL(image.previewUrl)
        previewUrlsRef.current.delete(image.previewUrl)
      }
      setPendingImages([])
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : String(error))
    } finally {
      setPreparingAttachments(false)
    }
  }

  async function toggleRecording(): Promise<void> {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    if (!speechEndpoint) {
      setVoiceMessage('Configure a local transcription endpoint in Settings first.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || !('MediaRecorder' in window)) {
      setVoiceMessage('This device does not support microphone recording in Mike Assist.')
      return
    }

    setVoiceMessage('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4']
        .find((candidate) => MediaRecorder.isTypeSupported(candidate))
      if (!mimeType) throw new Error('This device has no supported microphone recording format.')

      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder
      chunksRef.current = []
      recordedBytesRef.current = 0
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return
        recordedBytesRef.current += event.data.size
        if (recordedBytesRef.current > 25_000_000) {
          setVoiceMessage('Recording reached the 25 MB limit; stopping.')
          recorder.stop()
          return
        }
        chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        if (voiceTimeoutRef.current) clearTimeout(voiceTimeoutRef.current)
        voiceTimeoutRef.current = null
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setRecording(false)
        void finishTranscription(recorder.mimeType || mimeType)
      }
      recorder.start(1000)
      setRecording(true)
      voiceTimeoutRef.current = setTimeout(() => {
        setVoiceMessage('Recording reached the 2-minute limit; stopping.')
        recorder.stop()
      }, 120_000)
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      if (voiceTimeoutRef.current) clearTimeout(voiceTimeoutRef.current)
      voiceTimeoutRef.current = null
      setRecording(false)
      setVoiceMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function finishTranscription(mimeType: string): Promise<void> {
    const blob = new Blob(chunksRef.current, { type: mimeType })
    chunksRef.current = []
    recorderRef.current = null
    if (blob.size === 0) {
      setVoiceMessage('No audio was recorded.')
      return
    }
    if (blob.size > 25_000_000) {
      setVoiceMessage('That recording is larger than the 25 MB local limit.')
      return
    }

    setTranscribing(true)
    setVoiceMessage('Transcribing on your local server…')
    try {
      const result = await onTranscribe(new Uint8Array(await blob.arrayBuffer()), blob.type)
      if (!result.ok || !result.text) {
        setVoiceMessage(result.error ?? 'The local server did not transcribe that recording.')
      } else if (voiceChatEnabled) {
        setVoiceMessage('Sending the transcript to the configured assistant…')
        void submitMessage(result.text)
      } else {
        onInputChange((input ? `${input.trimEnd()} ` : '') + result.text)
        setVoiceMessage('Transcription added to the composer.')
        textareaRef.current?.focus()
      }
    } catch (error) {
      setVoiceMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setTranscribing(false)
    }
  }

  async function saveWorkflow(): Promise<void> {
    if (!workflowName.trim()) return
    setWorkflowSaving(true)
    setWorkflowSaveMessage('')
    try {
      const result = await onSaveWorkflow(workflowName.trim())
      if (result.ok) {
        setWorkflowSaveMessage('Saved locally. Replay repeats exact arguments through the permission gateway.')
        setWorkflowName('')
        setWorkflowSaveOpen(false)
      } else {
        setWorkflowSaveMessage(result.error ?? 'Could not save the workflow.')
      }
    } catch (error) {
      setWorkflowSaveMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setWorkflowSaving(false)
    }
  }

  async function learnSkill(): Promise<void> {
    if (!workflowCandidate) return
    setSkillLearningMessage('')
    try {
      const accepted = await onSend(buildSkillLearningRequest(workflowCandidate.steps))
      if (!accepted) setSkillLearningMessage('Could not start the skill draft. Try again when chat is ready.')
    } catch (error) {
      setSkillLearningMessage(error instanceof Error ? error.message : String(error))
    }
  }

  function selectVoiceMode(liveChat: boolean): void {
    if (voiceChatEnabled !== liveChat) onToggleVoiceChat()
    if (voiceModeMenuRef.current) voiceModeMenuRef.current.open = false
  }

  return (
    <div className="chat">
      <div className="chat-scroll">
        <div className={`chat-column${items.length === 0 ? ' chat-column-empty' : ''}`}>
          {providerSetupRequired && items.length > 0 && (
            <div className="chat-setup-notice" role="status">
              <span>Chat setup is required before you can send a new message.</span>
              <button className="primary-button" type="button" onClick={onOpenSettings}>Open Settings</button>
            </div>
          )}
          {items.length === 0 && (
            <EmptyState
              onPick={(text) => void onSend(text)}
              disabled={busy || providerSetupRequired}
              providerSetupRequired={providerSetupRequired}
              onOpenSettings={onOpenSettings}
            />
          )}

          {items.map((item) =>
            item.kind === 'message' ? (
              <MessageRow
                key={item.message.id}
                message={item.message}
                disabled={busy}
                onDelete={onDeleteMessage}
                onCitationClick={onCitationClick}
              />
            ) : (
              <ToolCardView key={item.id} card={item} />
            )
          )}

          {busy && <ThinkingRow />}
          <div ref={endRef} />
        </div>
      </div>

      <div className="composer-wrap">
        {workflowCandidate && !busy && (
          <div className="workflow-save-panel">
            <div className="workflow-save-actions">
              {!workflowSaveOpen && (
                <button className="workflow-save-open" type="button" onClick={() => setWorkflowSaveOpen(true)}>
                  Save exact steps as workflow…
                </button>
              )}
              {chatMode !== 'review' && chatMode !== 'brainstorm' && (
                <button className="workflow-save-open skill-learn-open" type="button" onClick={() => void learnSkill()}>
                  Draft a reusable skill from this task…
                </button>
              )}
            </div>
            {!workflowSaveOpen && <div className="workflow-save-hint">The assistant will generalize the process. You review and approve the full skill before it is saved.</div>}
            {workflowSaveOpen && (
              <div className="workflow-save-form">
                <input
                  value={workflowName}
                  maxLength={80}
                  onChange={(event) => setWorkflowName(event.target.value)}
                  placeholder="Workflow name"
                  aria-label="Workflow name"
                />
                <span>{workflowCandidate.steps.length} replayable local steps · stored on this device</span>
                <button type="button" className="primary-button" disabled={workflowSaving || !workflowName.trim()} onClick={() => void saveWorkflow()}>
                  {workflowSaving ? 'Saving…' : 'Save workflow'}
                </button>
                <button type="button" className="ghost-button" onClick={() => setWorkflowSaveOpen(false)}>
                  Cancel
                </button>
              </div>
            )}
            {workflowSaveMessage && <div className="workflow-save-message" role="status">{workflowSaveMessage}</div>}
            {skillLearningMessage && <div className="workflow-save-message" role="status">{skillLearningMessage}</div>}
          </div>
        )}
        {pendingImages.length > 0 && (
          <div className="image-attachment-panel">
            <div className="image-attachment-list">
              {pendingImages.map((image) => (
                <div className="image-attachment-preview" key={image.previewUrl}>
                  <img src={image.previewUrl} alt={`Preview of ${image.file.name}`} />
                  <span title={image.file.name}>{image.file.name || 'image'} · {formatImageSize(image.file.size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${image.file.name || 'image'}`}
                    disabled={preparingAttachments}
                    onClick={() => removeImage(image.previewUrl)}
                  >×</button>
                </div>
              ))}
            </div>
            <div className="image-attachment-notice">{imageDestinationNotice(providerEndpoint)}</div>
          </div>
        )}
        {attachmentError && <div className="attachment-error" role="alert">{attachmentError}</div>}
        <input
          ref={imageInputRef}
          className="visually-hidden"
          type="file"
          accept={CHAT_IMAGE_MIME_TYPES.join(',')}
          multiple
          tabIndex={-1}
          aria-label="Choose images"
          onChange={(event) => {
            addImages(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
        />
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault()
            void submitMessage()
          }}
        >
          <div className="composer-prompt-row">
            <textarea
              ref={textareaRef}
              value={input}
              disabled={busy || preparingAttachments || providerSetupRequired}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submitMessage()
                }
              }}
              placeholder={providerSetupRequired ? 'Set up chat in Settings before sending…' : 'Ask Mike Assist…'}
              rows={1}
              aria-label="Message Mike Assist"
            />
          </div>
          <div className="composer-toolbar" role="group" aria-label="Chat controls">
            <div className="composer-settings-controls">
            <select
              className="composer-control composer-mode-control"
              value={chatMode}
              disabled={busy || providerUpdating}
              aria-label="Work mode"
              title="Choose how Mike Assist should work"
              onChange={(event) => onChatModeChange(event.target.value as ChatMode)}
            >
              <option value="assistant">Assistant</option>
              <option value="brainstorm">Brainstorm</option>
              <option value="software">Software</option>
              <option value="review">Project review</option>
              <option value="plan">Plan</option>
              <option value="build">Build</option>
              <option value="goal">Goal</option>
              {chatMode === 'coach_personal' && <option value="coach_personal">Personal coach</option>}
              {chatMode === 'coach_business' && <option value="coach_business">Business coach</option>}
            </select>
            <span className="composer-toolbar-divider" aria-hidden="true" />
            <select
              className="composer-control composer-provider-control"
              value={providerSettings?.preset ?? ''}
              disabled={!providerSettings || busy || providerUpdating}
              aria-label="AI provider"
              title="Choose a saved AI provider"
              onChange={(event) => void chooseProvider(event.target.value)}
            >
              {!providerSettings && <option value="">Loading provider…</option>}
              {PROVIDER_PRESETS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
            </select>
            <select
              className="composer-control composer-model-control"
              value={providerSettings?.model ?? ''}
              disabled={!providerSettings || busy || providerUpdating}
              aria-label="AI model"
              title="Choose a model from the selected provider"
              onFocus={() => {
                if (!modelsLoaded && !modelsLoading) void refreshModels()
              }}
              onChange={(event) => void saveProviderPatch({ model: event.target.value })}
            >
              {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
              {modelOptions.length === 0 && <option value="">Open model list to load…</option>}
            </select>
            <button
              className="composer-refresh-models"
              type="button"
              disabled={!providerSettings || modelsLoading || providerUpdating || busy}
              onClick={() => void refreshModels()}
              aria-label="Refresh available models"
              title="Refresh available models"
            ><RefreshIcon spinning={modelsLoading} /></button>
            <select
              className="composer-control composer-effort-control"
              value={chatEffort}
              disabled={busy || providerUpdating}
              aria-label="Response effort"
              title="Choose response depth"
              onChange={(event) => onChatEffortChange(event.target.value as ChatEffort)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            {providerSettings && providerSetupRequired && (
              <button className="composer-settings-link" type="button" onClick={onOpenSettings}>Settings</button>
            )}
            {(providerUpdating || modelMessage || providerError) && (
              <span className={`composer-control-message ${providerError || (modelMessage && !modelMessage.startsWith('Add this provider')) ? 'is-error' : ''}`} role={providerError ? 'alert' : 'status'}>
                {providerUpdating ? 'Saving…' : providerError || modelMessage}
              </span>
            )}
            </div>
            <div className="composer-actions">
            <button
              className="attach-image-button icon-only-button"
              type="button"
              disabled={busy || preparingAttachments || providerSetupRequired || pendingImages.length >= MAX_CHAT_IMAGE_ATTACHMENTS}
              onClick={() => imageInputRef.current?.click()}
              title={`Attach up to ${MAX_CHAT_IMAGE_ATTACHMENTS} images. Attached images are sent to your configured model.`}
              aria-label="Attach images"
            ><ImageIcon /></button>
            <div className={`voice-control ${recording ? 'voice-control-recording' : ''}`}>
            <button
              className="voice-button icon-only-button"
              type="button"
              disabled={providerSetupRequired || busy || preparingAttachments || transcribing || (!speechEndpoint && !recording) || typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia}
              onClick={() => void toggleRecording()}
              title={recording ? 'Stop voice recording' : speechEndpoint ? voiceChatEnabled ? 'Record a live voice chat turn' : 'Dictate into the message box' : 'Configure a local speech endpoint in Settings'}
              aria-label={recording ? 'Stop voice recording' : transcribing ? 'Transcribing voice' : voiceChatEnabled ? 'Start live voice chat recording' : 'Start dictation'}
            >
              {recording ? <StopIcon /> : transcribing ? <span className="voice-spinner" /> : <MicrophoneIcon />}
            </button>
            <details
              className="voice-mode-menu"
              ref={voiceModeMenuRef}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && voiceModeMenuRef.current) {
                  voiceModeMenuRef.current.open = false
                }
              }}
            >
              <summary title="Choose voice mode" aria-label="Choose voice mode">
                <ChevronDownIcon />
              </summary>
              <div className="voice-mode-popover" role="group" aria-label="Voice mode">
                <button
                  type="button"
                  className="voice-mode-option"
                  aria-pressed={!voiceChatEnabled}
                  disabled={providerSetupRequired}
                  onClick={() => selectVoiceMode(false)}
                >
                  <strong>Dictate</strong>
                  <span>Transcribe into the composer</span>
                </button>
                <button
                  type="button"
                  className="voice-mode-option"
                  aria-pressed={voiceChatEnabled}
                  disabled={providerSetupRequired}
                  onClick={() => selectVoiceMode(true)}
                >
                  <strong>Live voice chat</strong>
                  <span>Send transcripts and speak replies</span>
                </button>
              </div>
            </details>
          </div>
            <button
              className="queue-task-button"
              type="button"
              disabled={providerSetupRequired || !input.trim() || pendingImages.length > 0}
              onClick={onQueueTask}
              title={pendingImages.length > 0 ? 'Remove images before queuing this prompt' : 'Add this prompt to the sequential task queue'}
            >
              Queue task
            </button>
            <button className="send-button" type="submit" disabled={!canSubmitComposer({
              providerSetupRequired,
              busy,
              preparingAttachments,
              input,
              pendingImageCount: pendingImages.length
            })}>
              {busy || preparingAttachments ? <span className="send-spinner" aria-label={preparingAttachments ? 'Preparing images' : 'Working'} /> : 'Send'}
            </button>
            {busy && (
              <button className="stop-button" type="button" onClick={onCancel}>
                Stop
              </button>
            )}
          </div>
          </div>
        </form>
        {queuedTasks.length > 0 && (
          <div className="task-queue">
            <div className="task-queue-head">
              <span>{queueRunning ? 'Running tasks sequentially' : `${queuedTasks.length} queued task${queuedTasks.length === 1 ? '' : 's'}`}</span>
              <button className="queue-run-button" type="button" disabled={busy || queueRunning} onClick={onRunQueue}>
                {queueRunning ? 'Queue running…' : 'Run queue'}
              </button>
            </div>
            <ol>
              {queuedTasks.map((task, index) => (
                <li key={`${index}-${task.slice(0, 24)}`}>
                  <span>{task}</span>
                  <button type="button" aria-label={`Remove queued task ${index + 1}`} onClick={() => onRemoveQueuedTask(index)}>
                    ×
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
        {voiceMessage && <div className="voice-status" role="status">{voiceMessage}</div>}
        <div className="composer-footer">
          <div className="composer-hint">
            {providerSetupRequired ? 'Chat configuration is managed in Settings.' : (
              'Enter to send · Shift+Enter for a new line · File writes require approval.'
            )}
          </div>
          <button
            className="composer-help-button"
            type="button"
            title={`Images stay in local chat history and are sent to your configured model. Follow-ups may resend earlier images.${conversationHasImages ? ' This chat contains images.' : ''} Voice transcription uses your local speech server. Live voice chat sends transcripts automatically and speaks replies locally.`}
            aria-label="More about images and voice in chat"
          >
            <InfoIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

function EmptyState({
  onPick,
  disabled,
  providerSetupRequired,
  onOpenSettings
}: {
  onPick: (text: string) => void
  disabled: boolean
  providerSetupRequired: boolean
  onOpenSettings: () => void
}): React.JSX.Element {
  return (
    <section className={`empty${providerSetupRequired ? ' empty-setup' : ''}`} aria-labelledby="chat-empty-title">
      <div className="empty-mark">M</div>
      <h2 id="chat-empty-title">{providerSetupRequired ? 'Set up chat' : 'Start with a task'}</h2>
      <p>
        {providerSetupRequired
          ? 'Open Settings to finish configuring your assistant before sending a message.'
          : 'Ask a question or choose a common request below. File changes wait for your approval.'}
      </p>
      {providerSetupRequired ? (
        <button className="primary-button" type="button" onClick={onOpenSettings}>Open Settings</button>
      ) : (
        <div className="suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.label}
              className="suggestion"
              type="button"
              disabled={disabled}
              onClick={() => onPick(suggestion.prompt)}
            >
              <SuggestionIcon name={suggestion.icon} />
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function SuggestionIcon({ name }: { name: SuggestionIconName }): React.JSX.Element {
  const paths: Record<SuggestionIconName, React.JSX.Element> = {
    folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
    idea: <>
      <path d="M9 18h6M10 21h4M8.5 14.5A6 6 0 1 1 15.5 15c-.8.5-1.3 1.3-1.5 2h-4c-.2-1-.7-1.8-1.5-2.5Z" />
      <path d="M12 2v1.5M4.8 4.8l1.1 1.1M19.2 4.8l-1.1 1.1" />
    </>,
    review: <>
      <path d="M7 3.5h7l4 4V20H7a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z" />
      <path d="M14 3.5v4h4M9 13h6M9 16h3" />
      <path d="m15 17 1.5 1.5L20 15" />
    </>,
    code: <>
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
    </>
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

function ImageIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4 17 5-5 3.5 3.5 2.5-2.5L20 18" />
    </svg>
  )
}

function MicrophoneIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
    </svg>
  )
}

function StopIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
}

function ChevronDownIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
}

function RefreshIcon({ spinning }: { spinning: boolean }): React.JSX.Element {
  return (
    <svg className={`composer-refresh-icon${spinning ? ' is-spinning' : ''}`} viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M5.6 9a7 7 0 0 1 11.7-2L20 12M4 12l2.7 5a7 7 0 0 0 11.7-2" />
    </svg>
  )
}

function InfoIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  )
}

function MessageRow({
  message,
  disabled,
  onDelete,
  onCitationClick
}: {
  message: ChatMessage
  disabled?: boolean
  onDelete?: (messageId: string) => void
  onCitationClick?: (label: string) => void
}): React.JSX.Element {
  if (message.role === 'system') {
    return <div className="system-message">{message.text}</div>
  }

  const isUser = message.role === 'user'

  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      <div className={`avatar ${isUser ? 'avatar-user' : 'avatar-assistant'}`}>
        {isUser ? 'Y' : 'M'}
      </div>
      <div className="message-content">
        <div className="bubble">
          <MarkdownMessage text={message.text} onCitationClick={onCitationClick} />
        </div>
        {message.attachments && message.attachments.length > 0 && (
          <div className="message-attachments" aria-label="Image attachments">
            {message.attachments.map((attachment) => (
              <span className="message-attachment-chip" key={attachment.id} title={attachment.name}>
                <span aria-hidden="true">▧</span>
                {attachment.name} · {formatImageSize(attachment.size)}
              </span>
            ))}
          </div>
        )}
        {onDelete && !disabled && (
          <div className="message-actions">
            <button
              type="button"
              className="ghost-button message-delete-btn"
              title="Delete message from this conversation"
              onClick={() => onDelete(message.id)}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function mimeTypeForImage(file: File): ChatImageAttachment['mimeType'] | null {
  const mimeType = file.type.toLowerCase()
  if (CHAT_IMAGE_MIME_TYPES.includes(mimeType as ChatImageAttachment['mimeType'])) {
    return mimeType as ChatImageAttachment['mimeType']
  }
  const extension = file.name.toLowerCase().split('.').pop()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  return null
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function formatImageSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function imageDestinationNotice(endpoint: string): string {
  const visionNote = 'Choose a vision-capable model in the chat controls; not all models accept images.'
  try {
    const url = new URL(endpoint)
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)) {
      return `Images are saved with this chat and sent to the local model on this device. ${visionNote}`
    }
    return `Images are saved with this chat and sent to the model at ${url.host}. ${visionNote}`
  } catch {
    return `Images are saved with this chat and sent to the provider configured in Settings. ${visionNote}`
  }
}

function ThinkingRow(): React.JSX.Element {
  return (
    <div className="message message-assistant">
      <div className="avatar avatar-assistant">M</div>
      <div className="thinking" aria-label="Working">
        <span />
        <span />
        <span />
      </div>
    </div>
  )
}
