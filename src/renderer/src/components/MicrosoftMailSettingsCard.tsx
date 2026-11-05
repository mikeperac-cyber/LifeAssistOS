import { useEffect, useRef, useState } from 'react'
import type {
  MicrosoftMailConnectStatus,
  MicrosoftMailConnectStatusResult,
  MicrosoftMailSettingsResult,
  PublicMicrosoftMailSettings
} from '../../../shared/ipc'

export function MicrosoftMailSettingsCard({
  settings,
  onUpdateClientId,
  onBeginConnect,
  onGetConnectStatus,
  onCancelConnect,
  onDisconnect
}: {
  settings: PublicMicrosoftMailSettings | null
  onUpdateClientId: (clientId: string) => Promise<MicrosoftMailSettingsResult>
  onBeginConnect: () => Promise<MicrosoftMailSettingsResult>
  onGetConnectStatus: () => Promise<MicrosoftMailConnectStatusResult>
  onCancelConnect: () => Promise<MicrosoftMailConnectStatusResult>
  onDisconnect: () => Promise<MicrosoftMailSettingsResult>
}): React.JSX.Element {
  const [clientId, setClientId] = useState(settings?.clientId ?? '')
  const [localSettings, setLocalSettings] = useState(settings)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [connectStatus, setConnectStatus] = useState<MicrosoftMailConnectStatus>({ phase: 'idle' })
  const pollBusy = useRef(false)
  const pollVersion = useRef(0)

  useEffect(() => {
    if (settings) setClientId(settings.clientId)
  }, [settings])

  useEffect(() => {
    let active = true
    const version = pollVersion.current
    void onGetConnectStatus().then((result) => {
      if (!active || version !== pollVersion.current) return
      if (result.ok && result.status) setConnectStatus(result.status)
    }).catch(() => undefined)
    return () => { active = false }
  }, [onGetConnectStatus])

  useEffect(() => {
    if (connectStatus.phase !== 'pending' && connectStatus.phase !== 'starting') return
    let active = true
    const version = pollVersion.current
    const poll = async (): Promise<void> => {
      if (!active || version !== pollVersion.current || pollBusy.current) return
      pollBusy.current = true
      try {
        const result = await onGetConnectStatus()
        if (!active || version !== pollVersion.current || !result.ok || !result.status) return
        setConnectStatus(result.status)
        if (result.settings) setLocalSettings(result.settings)
        if (result.status.phase === 'connected') setMessage('Outlook Mail connected. Each search and message read still asks for approval.')
        if (result.status.phase === 'failed') setMessage(result.status.error ?? 'Outlook Mail sign-in failed.')
      } catch {
        // A later poll can recover from a temporary IPC failure.
      } finally {
        pollBusy.current = false
      }
    }
    const timer = window.setInterval(() => { void poll() }, 1_500)
    return () => { active = false; window.clearInterval(timer) }
  }, [connectStatus.phase, onGetConnectStatus])

  useEffect(() => { setLocalSettings(settings) }, [settings])

  async function connect(): Promise<void> {
    pollVersion.current += 1
    const id = clientId.trim()
    if (!id) {
      setMessage('Enter a Microsoft Entra Application (client) ID first.')
      return
    }
    setBusy(true)
    setMessage('Starting Microsoft sign-in…')
    try {
      const saved = await onUpdateClientId(id)
      if (!saved.ok) {
        setMessage(saved.error ?? 'Could not save the Microsoft Application ID.')
        return
      }
      if (saved.settings) setLocalSettings(saved.settings)
      const result = await onBeginConnect()
      if (!result.ok || !result.prompt) {
        setMessage(result.error ?? 'Could not start Microsoft sign-in.')
        return
      }
      if (result.settings) setLocalSettings(result.settings)
      setConnectStatus({ phase: 'pending', prompt: result.prompt })
      setMessage('Enter the displayed code on Microsoft’s sign-in page to approve this connection.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function cancelSignIn(): Promise<void> {
    pollVersion.current += 1
    setBusy(true)
    try {
      const result = await onCancelConnect()
      if (result.status) setConnectStatus(result.status)
      if (result.settings) setLocalSettings(result.settings)
      setMessage(result.ok ? 'Microsoft sign-in cancelled.' : result.error ?? 'Could not cancel sign-in.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function disconnect(): Promise<void> {
    pollVersion.current += 1
    setBusy(true)
    setMessage('')
    try {
      const result = await onDisconnect()
      if (result.settings) setLocalSettings(result.settings)
      setMessage(result.ok
        ? result.message ?? 'Outlook Mail disconnected in Mike Assist.'
        : result.error ?? 'Could not disconnect Outlook Mail.')
      if (result.ok) setConnectStatus({ phase: 'idle' })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section">
      <div className="section-head">
        <h2>Outlook Mail</h2>
        <p>
          Search your mailbox and read a selected message in Chat with delegated read-only <code>Mail.Read</code> access.
          Each search and message read asks for approval. Mike Assist cannot send, draft, delete, or change messages.
          Approved message results and the assistant reply stay in memory for this session and are not saved in chat history.
        </p>
      </div>
      {localSettings ? (
        <div className="web-search-settings">
          <label className="field field-wide">
            <span className="field-label">
              Microsoft Entra Application (client) ID
              {localSettings.connected
                ? <span className="field-tag">{localSettings.tokenStored ? 'connected · encrypted' : 'connected · session only'}</span>
                : localSettings.tokenStored
                  ? <span className="field-tag">saved token unavailable</span>
                  : null}
            </span>
            <input
              value={clientId}
              autoComplete="off"
              spellCheck={false}
              disabled={localSettings.connected || localSettings.tokenStored || busy || connectStatus.phase === 'pending'}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="00000000-0000-4000-8000-000000000000"
            />
            <span className="field-hint">
              Register a public-client app supporting personal and work or school accounts, enable public-client flows,
              and add delegated Microsoft Graph <code>Mail.Read</code>. Device-code sign-in needs no client secret.
              See Microsoft’s <a href="https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code" target="_blank" rel="noreferrer">device-code guide</a>,
              <a href="https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0" target="_blank" rel="noreferrer">list messages API</a>,
              <a href="https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0" target="_blank" rel="noreferrer">get message API</a>, and
              <a href="https://entra.microsoft.com/" target="_blank" rel="noreferrer">Entra admin center</a>.
            </span>
            {localSettings.tokenStored && !localSettings.connected && (
              <span className="field-hint">Mike Assist could not unlock this saved token. Reconnect with this Application ID, or clear the saved connection and connect again.</span>
            )}
          </label>
          {connectStatus.phase === 'pending' && connectStatus.prompt && (
            <div className="today-google-tasks-empty" role="status" aria-live="polite">
              <strong>Finish sign-in in your browser</strong>
              <span>Open {connectStatus.prompt.verificationUri} and enter this one-time code:</span>
              <code className="microsoft-todo-user-code">{connectStatus.prompt.userCode}</code>
              <span>Code expires at {new Date(connectStatus.prompt.expiresAt).toLocaleTimeString()}.</span>
            </div>
          )}
          <div className="settings-actions">
            {localSettings.connected ? (
              <button className="danger-button" type="button" onClick={() => void disconnect()} disabled={busy}>
                {busy ? 'Disconnecting…' : 'Disconnect in Mike Assist'}
              </button>
            ) : connectStatus.phase === 'pending' ? (
              <button className="danger-button" type="button" onClick={() => void cancelSignIn()} disabled={busy}>
                {busy ? 'Cancelling…' : 'Cancel sign-in'}
              </button>
            ) : localSettings.tokenStored ? (
              <>
                <button className="primary-button" type="button" onClick={() => void connect()} disabled={busy || !clientId.trim()}>
                  {busy ? 'Starting sign-in…' : 'Reconnect Outlook Mail'}
                </button>
                <button className="danger-button" type="button" onClick={() => void disconnect()} disabled={busy}>
                  {busy ? 'Clearing…' : 'Clear saved connection'}
                </button>
              </>
            ) : (
              <button className="primary-button" type="button" onClick={() => void connect()} disabled={busy || !clientId.trim()}>
                {busy ? 'Starting sign-in…' : 'Connect Outlook Mail'}
              </button>
            )}
            {message && <span className="settings-status" role="status">{message}</span>}
          </div>
        </div>
      ) : (
        <p className="muted">Loading Outlook Mail settings…</p>
      )}
    </section>
  )
}
