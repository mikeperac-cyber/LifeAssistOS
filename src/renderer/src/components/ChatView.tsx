import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  CHAT_IMAGE_MIME_TYPES,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_TOTAL_BYTES,
  type ChatImageAttachment,
  type ChatImageAttachmentInput,
  type ChatMessage,
  type ChatMode
} from '../../../shared/types'
import type { SpeechResult, WorkflowMutationResult } from '../../../shared/ipc'
import type { WorkflowStep } from '../../../shared/types'
import type { TimelineItem } from '../types'
import { buildSkillLearningRequest } from '../skill-learning'
import { MarkdownMessage } from './MarkdownMessage'
import { ToolCardView } from './ToolCardView'

export interface ChatViewProps {
  items: TimelineItem[]
  chatMode: ChatMode
  busy: boolean
  input: string
  onInputChange: (value: string) => void
  onSend: (text?: string, attachments?: ChatImageAttachmentInput[]) => Promise<boolean>
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
  endRef: RefObject<HTMLDivElement | null>
  onDeleteMessage?: (messageId: string) => void
  onCitationClick?: (label: string) => void
}

interface PendingImage {
  file: File
  mimeType: ChatImageAttachment['mimeType']
  previewUrl: string
}

const SUGGESTIONS = [
  { label: 'List my workspace', prompt: 'List the files in my workspace' },
  {
    label: 'Brainstorm ideas',
    prompt: 'I want a brainstorm partner. Ask me what goal I am working on, then help me explore diverse ideas and trade-offs.'
  },
  {
    label: 'Review my project',
    prompt: 'Check my approved project folder for bugs, security issues, and missing tests. Use project_overview, read the README, manifests, and key source files. Do not modify anything; report prioritized actionable findings with file paths. If it is unclear which approved folder is the project, ask me first.'
  },
  {
    label: 'Create software',
    prompt: 'Help me create a software project. First ask about its purpose, users, target platform, and constraints. Then propose a file plan; do not modify files until I approve each change.'
  },
  { label: 'Create a note', prompt: 'Create notes/hello.md with Hello from Mike Assist' },
  { label: 'Read it back', prompt: 'Read notes/hello.md' }
]

export function ChatView({
  items,
  chatMode,
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
  endRef,
  onDeleteMessage,
  onCitationClick
}: ChatViewProps): React.JSX.Element {
  const conversationHasImages = items.some(
    (item) => item.kind === 'message' && Boolean(item.message.attachments?.length)
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
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
    if (busy || preparingAttachments || (!trimmed && pendingImages.length === 0)) return
    setAttachmentError('')
    setPreparingAttachments(true)
    try {
      const attachments = await Promise.all(pendingImages.map(async ({ file, mimeType }) => ({
        name: file.name || 'image',
        mimeType,
        data: await fileToBase64(file)
      })))
      const accepted = await onSend(trimmed, attachments)
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

  return (
    <div className="chat">
      <div className="chat-scroll">
        <div className="chat-column">
          {items.length === 0 && <EmptyState onPick={onSend} disabled={busy} />}

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
          <textarea
            ref={textareaRef}
            value={input}
            disabled={busy || preparingAttachments}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submitMessage()
              }
            }}
            placeholder="Ask Mike Assist…"
            rows={1}
            aria-label="Message Mike Assist"
          />
          <button
            className="attach-image-button"
            type="button"
            disabled={busy || preparingAttachments || pendingImages.length >= MAX_CHAT_IMAGE_ATTACHMENTS}
            onClick={() => imageInputRef.current?.click()}
            title={`Attach up to ${MAX_CHAT_IMAGE_ATTACHMENTS} PNG, JPEG, or WebP images`}
            aria-label="Attach images"
          >Image</button>
          <button
            className={`voice-button ${recording ? 'voice-recording' : ''}`}
            type="button"
            disabled={busy || preparingAttachments || transcribing || (!speechEndpoint && !recording) || typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia}
            onClick={() => void toggleRecording()}
            title={speechEndpoint ? 'Record and transcribe with your configured local server' : 'Configure a local speech endpoint in Settings'}
            aria-label={recording ? 'Stop recording' : 'Start voice input'}
          >
            {recording ? 'Stop' : transcribing ? 'Transcribing…' : 'Voice'}
          </button>
          <button
            className={`voice-chat-toggle ${voiceChatEnabled ? 'voice-chat-active' : ''}`}
            type="button"
            aria-pressed={voiceChatEnabled}
            onClick={onToggleVoiceChat}
            title="Speak replies locally and automatically send push-to-talk transcripts to the configured assistant"
          >
            {voiceChatEnabled ? 'Voice chat on' : 'Voice chat'}
          </button>
          <button
            className="queue-task-button"
            type="button"
            disabled={!input.trim() || pendingImages.length > 0}
            onClick={onQueueTask}
            title={pendingImages.length > 0 ? 'Remove images before queuing this prompt' : 'Add this prompt to the sequential task queue'}
          >
            Queue task
          </button>
          <button className="send-button" type="submit" disabled={busy || preparingAttachments || (input.trim().length === 0 && pendingImages.length === 0)}>
            {busy || preparingAttachments ? <span className="send-spinner" aria-label={preparingAttachments ? 'Preparing images' : 'Working'} /> : 'Send'}
          </button>
          {busy && (
            <button className="stop-button" type="button" onClick={onCancel}>
              Stop
            </button>
          )}
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
        <div className="composer-hint">
          Enter to send · Shift+Enter for a new line · writes require approval
          {' · images stay in chat history and go to the configured model'}
          {conversationHasImages ? ' · previous images may be sent again with follow-ups' : ''}
          {speechEndpoint ? ' · voice uses your local server' : ''}
          {voiceChatEnabled ? ' · voice chat auto-sends transcripts and speaks replies locally' : ''}
        </div>
      </div>
    </div>
  )
}

function EmptyState({
  onPick,
  disabled
}: {
  onPick: (text: string) => void
  disabled: boolean
}): React.JSX.Element {
  return (
    <div className="empty">
      <div className="empty-mark">M</div>
      <h2>What should I handle?</h2>
      <p>
        I can look around your approved folders and read files. Anything that writes stops here for
        your approval.
      </p>
      <div className="suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.label}
            className="suggestion"
            type="button"
            disabled={disabled}
            onClick={() => onPick(suggestion.prompt)}
          >
            <span className="suggestion-arrow">↗</span>
            {suggestion.label}
          </button>
        ))}
      </div>
    </div>
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
  const visionNote = 'Choose a vision-capable model in Settings; not all models accept images.'
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
