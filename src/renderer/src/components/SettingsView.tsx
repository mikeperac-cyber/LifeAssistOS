import { useEffect, useState } from 'react'
import type { FolderGrant, ProviderStatus } from '../../../shared/types'
import type {
  GrantMutationResult,
  DomainMutationResult,
  BackupResult,
  PublicSettings,
  PublicWebSearchSettings,
  PublicGoogleCalendarSettings,
  PublicGoogleGmailSettings,
  PublicGoogleDriveSettings,
  PublicGoogleTasksSettings,
  LocalApiResult,
  LocalApiStatus,
  SettingsPatch,
  SettingsResult,
  WebSearchSettingsResult,
  GoogleCalendarSettingsResult,
  GoogleGmailSettingsResult,
  GoogleDriveSettingsResult,
  GoogleTasksSettingsResult
} from '../../../shared/ipc'
import { PROVIDER_PRESETS, presetFor } from '../../../shared/presets'
import { McpPanel } from './McpPanel'
import { APP_THEMES, type AppTheme } from '../theme'

type Access = 'read' | 'read-write'

interface FormState {
  preset: PublicSettings['provider']['preset']
  baseUrl: string
  model: string
  fastModel: string
  visionModel: string
  keepInBackground: boolean
  contextLength: number
  temperature: number
  maxSteps: number
  apiKey: string
}

export interface SettingsViewProps {
  settings: PublicSettings
  theme: AppTheme
  onThemeChange: (theme: AppTheme) => void
  webSearchSettings: PublicWebSearchSettings | null
  googleCalendarSettings: PublicGoogleCalendarSettings | null
  googleGmailSettings: PublicGoogleGmailSettings | null
  googleDriveSettings: PublicGoogleDriveSettings | null
  googleTasksSettings: PublicGoogleTasksSettings | null
  grants: FolderGrant[]
  onSave: (patch: SettingsPatch) => Promise<SettingsResult>
  onUpdateWebSearchApiKey: (apiKey: string | null) => Promise<WebSearchSettingsResult>
  onUpdateGoogleCalendarClientId: (clientId: string) => Promise<GoogleCalendarSettingsResult>
  onConnectGoogleCalendar: () => Promise<GoogleCalendarSettingsResult>
  onDisconnectGoogleCalendar: () => Promise<GoogleCalendarSettingsResult>
  onUpdateGoogleGmailClientId: (clientId: string) => Promise<GoogleGmailSettingsResult>
  onConnectGoogleGmail: () => Promise<GoogleGmailSettingsResult>
  onDisconnectGoogleGmail: () => Promise<GoogleGmailSettingsResult>
  onUpdateGoogleDriveClientId: (clientId: string) => Promise<GoogleDriveSettingsResult>
  onConnectGoogleDrive: () => Promise<GoogleDriveSettingsResult>
  onDisconnectGoogleDrive: () => Promise<GoogleDriveSettingsResult>
  onUpdateGoogleTasksClientId: (clientId: string) => Promise<GoogleTasksSettingsResult>
  onConnectGoogleTasks: () => Promise<GoogleTasksSettingsResult>
  onDisconnectGoogleTasks: () => Promise<GoogleTasksSettingsResult>
  onTest: () => Promise<ProviderStatus>
  onAddGrant: (access: Access) => Promise<GrantMutationResult>
  onRemoveGrant: (id: string) => Promise<GrantMutationResult>
  onSetGrantAccess: (id: string, access: Access) => Promise<GrantMutationResult>
  allowedDomains: string[]
  onAddDomain: (host: string) => Promise<DomainMutationResult>
  onRemoveDomain: (host: string) => Promise<DomainMutationResult>
  onBackup: (passphrase?: string) => Promise<BackupResult>
  onRestoreBackup?: (passphrase?: string) => Promise<BackupResult>
  speechEndpoint: string
  onUpdateSpeechEndpoint: (endpoint: string) => Promise<{ ok: boolean; endpoint?: string; error?: string }>
  localApiStatus: LocalApiStatus | null
  onSetLocalApiEnabled: (enabled: boolean) => Promise<LocalApiResult>
}

export function SettingsView({
  settings,
  theme,
  onThemeChange,
  webSearchSettings,
  googleCalendarSettings,
  googleGmailSettings,
  googleDriveSettings,
  googleTasksSettings,
  grants,
  onSave,
  onUpdateWebSearchApiKey,
  onUpdateGoogleCalendarClientId,
  onConnectGoogleCalendar,
  onDisconnectGoogleCalendar,
  onUpdateGoogleGmailClientId,
  onConnectGoogleGmail,
  onDisconnectGoogleGmail,
  onUpdateGoogleDriveClientId,
  onConnectGoogleDrive,
  onDisconnectGoogleDrive,
  onUpdateGoogleTasksClientId,
  onConnectGoogleTasks,
  onDisconnectGoogleTasks,
  onTest,
  onAddGrant,
  onRemoveGrant,
  onSetGrantAccess,
  allowedDomains,
  onAddDomain,
  onRemoveDomain,
  onBackup,
  onRestoreBackup,
  speechEndpoint,
  onUpdateSpeechEndpoint,
  localApiStatus,
  onSetLocalApiEnabled
}: SettingsViewProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(() => toForm(settings))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [grantError, setGrantError] = useState('')
  const [grantBusy, setGrantBusy] = useState(false)
  const [newAccess, setNewAccess] = useState<Access>('read')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [domainInput, setDomainInput] = useState('')
  const [domainError, setDomainError] = useState('')
  const [domainBusy, setDomainBusy] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const [backupPassphrase, setBackupPassphrase] = useState('')
  const [speechInput, setSpeechInput] = useState(speechEndpoint)
  const [speechBusy, setSpeechBusy] = useState(false)
  const [speechMessage, setSpeechMessage] = useState('')
  const [webSearchKey, setWebSearchKey] = useState('')
  const [webSearchBusy, setWebSearchBusy] = useState(false)
  const [webSearchMessage, setWebSearchMessage] = useState('')
  const [googleClientId, setGoogleClientId] = useState(googleCalendarSettings?.clientId ?? '')
  const [googleCalendarBusy, setGoogleCalendarBusy] = useState(false)
  const [googleCalendarMessage, setGoogleCalendarMessage] = useState('')
  const [googleGmailClientId, setGoogleGmailClientId] = useState(googleGmailSettings?.clientId ?? '')
  const [googleGmailBusy, setGoogleGmailBusy] = useState(false)
  const [googleGmailMessage, setGoogleGmailMessage] = useState('')
  const [googleGmailConsentOpen, setGoogleGmailConsentOpen] = useState(false)
  const [googleDriveClientId, setGoogleDriveClientId] = useState(googleDriveSettings?.clientId ?? '')
  const [googleDriveBusy, setGoogleDriveBusy] = useState(false)
  const [googleDriveMessage, setGoogleDriveMessage] = useState('')
  const [googleDriveConsentOpen, setGoogleDriveConsentOpen] = useState(false)
  const [googleTasksClientId, setGoogleTasksClientId] = useState(
    googleTasksSettings?.clientId || googleCalendarSettings?.clientId || googleGmailSettings?.clientId || googleDriveSettings?.clientId || ''
  )
  const [googleTasksBusy, setGoogleTasksBusy] = useState(false)
  const [googleTasksMessage, setGoogleTasksMessage] = useState('')
  const [localApiBusy, setLocalApiBusy] = useState(false)
  const [localApiMessage, setLocalApiMessage] = useState('')

  useEffect(() => {
    setForm(toForm(settings))
  }, [settings])

  useEffect(() => {
    setSpeechInput(speechEndpoint)
  }, [speechEndpoint])

  useEffect(() => {
    if (googleCalendarSettings) setGoogleClientId(googleCalendarSettings.clientId)
  }, [googleCalendarSettings])

  useEffect(() => {
    if (googleGmailSettings) setGoogleGmailClientId(googleGmailSettings.clientId)
  }, [googleGmailSettings])

  useEffect(() => {
    if (googleDriveSettings) setGoogleDriveClientId(googleDriveSettings.clientId)
  }, [googleDriveSettings])

  useEffect(() => {
    if (googleTasksSettings) {
      setGoogleTasksClientId(googleTasksSettings.clientId || googleCalendarSettings?.clientId || googleGmailSettings?.clientId || googleDriveSettings?.clientId || '')
    }
  }, [googleTasksSettings, googleCalendarSettings, googleGmailSettings, googleDriveSettings])

  const preset = presetFor(form.preset)

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function choosePreset(id: FormState['preset']): void {
    const next = presetFor(id)
    setForm((current) => ({
      ...current,
      preset: id,
      baseUrl: next.baseUrl,
      model: next.model || current.model
    }))
  }

  function patch(): SettingsPatch {
    const next: SettingsPatch = {
      preset: form.preset,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      fastModel: form.fastModel.trim(),
      visionModel: form.visionModel.trim(),
      keepInBackground: form.keepInBackground,
      contextLength: Number(form.contextLength),
      temperature: Number(form.temperature),
      maxSteps: Number(form.maxSteps)
    }
    if (form.apiKey.trim().length > 0) next.apiKey = form.apiKey.trim()
    return next
  }

  async function save(): Promise<void> {
    setSaving(true)
    setStatus(null)

    try {
      const result = await onSave(patch())
      if (!result.ok) {
        setStatus({ ok: false, text: result.error ?? 'Could not save these settings.' })
      } else {
        setStatus({ ok: true, text: 'Settings saved.' })
        setForm((current) => ({ ...current, apiKey: '' }))
      }
    } catch (error) {
      setStatus({ ok: false, text: errorText(error) })
    } finally {
      setSaving(false)
    }
  }

  async function test(): Promise<void> {
    setTesting(true)
    setStatus(null)

    try {
      const saved = await onSave(patch())
      if (!saved.ok) {
        setStatus({ ok: false, text: saved.error ?? 'Could not save these settings.' })
        return
      }

      setForm((current) => ({ ...current, apiKey: '' }))
      const result = await onTest()
      setStatus({ ok: result.ok, text: result.message })
      if (result.models) setModels(result.models)
    } catch (error) {
      setStatus({ ok: false, text: errorText(error) })
    } finally {
      setTesting(false)
    }
  }

  async function clearKey(): Promise<void> {
    setSaving(true)
    setStatus(null)

    try {
      const result = await onSave({ apiKey: null })
      setStatus(
        result.ok
          ? { ok: true, text: 'API key cleared.' }
          : { ok: false, text: result.error ?? 'Could not clear the key.' }
      )
    } catch (error) {
      setStatus({ ok: false, text: errorText(error) })
    } finally {
      setSaving(false)
    }
  }

  async function addFolder(): Promise<void> {
    setGrantBusy(true)
    setGrantError('')

    try {
      const result = await onAddGrant(newAccess)
      if (!result.ok && !result.cancelled) {
        setGrantError(result.error ?? 'Could not add that folder.')
      }
    } catch (error) {
      setGrantError(errorText(error))
    } finally {
      setGrantBusy(false)
    }
  }

  async function changeAccess(id: string, access: Access): Promise<void> {
    setGrantBusy(true)
    setGrantError('')

    try {
      const result = await onSetGrantAccess(id, access)
      if (!result.ok) setGrantError(result.error ?? 'Could not change access.')
    } catch (error) {
      setGrantError(errorText(error))
    } finally {
      setGrantBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    if (confirming !== id) {
      setConfirming(id)
      return
    }

    setGrantBusy(true)
    setGrantError('')
    setConfirming(null)

    try {
      const result = await onRemoveGrant(id)
      if (!result.ok) setGrantError(result.error ?? 'Could not remove that folder.')
    } catch (error) {
      setGrantError(errorText(error))
    } finally {
      setGrantBusy(false)
    }
  }

  async function addDomain(): Promise<void> {
    const value = domainInput.trim()
    if (!value) return
    setDomainBusy(true)
    setDomainError('')
    try {
      const result = await onAddDomain(value)
      if (!result.ok) setDomainError(result.error ?? 'Could not add that domain.')
      else setDomainInput('')
    } catch (error) {
      setDomainError(errorText(error))
    } finally {
      setDomainBusy(false)
    }
  }

  async function removeDomain(host: string): Promise<void> {
    setDomainBusy(true)
    setDomainError('')
    try {
      const result = await onRemoveDomain(host)
      if (!result.ok) setDomainError(result.error ?? 'Could not remove that domain.')
    } catch (error) {
      setDomainError(errorText(error))
    } finally {
      setDomainBusy(false)
    }
  }

  async function createBackup(): Promise<void> {
    setBackupBusy(true)
    setBackupMessage('')
    try {
      const result = await onBackup(backupPassphrase.trim() || undefined)
      if (result.ok) setBackupMessage([`Created ${result.folderName ?? 'backup folder'}.`, result.warning].filter(Boolean).join(' '))
      else if (!result.cancelled) setBackupMessage(result.error ?? 'Could not create the backup.')
    } catch (error) {
      setBackupMessage(errorText(error))
    } finally {
      setBackupBusy(false)
    }
  }

  async function restoreBackup(): Promise<void> {
    if (!onRestoreBackup) return
    setBackupBusy(true)
    setBackupMessage('')
    try {
      const result = await onRestoreBackup(backupPassphrase.trim() || undefined)
      if (result.ok) setBackupMessage([`Restored from ${result.folderName ?? 'backup folder'}.`, result.warning].filter(Boolean).join(' '))
      else if (!result.cancelled) setBackupMessage(result.error ?? 'Could not restore the backup.')
    } catch (error) {
      setBackupMessage(errorText(error))
    } finally {
      setBackupBusy(false)
    }
  }

  async function saveSpeechEndpoint(): Promise<void> {
    setSpeechBusy(true)
    setSpeechMessage('')
    try {
      const result = await onUpdateSpeechEndpoint(speechInput.trim())
      if (!result.ok) setSpeechMessage(result.error ?? 'Could not save the endpoint.')
      else setSpeechMessage(result.endpoint ? 'Local speech endpoint saved.' : 'Voice input disabled.')
    } catch (error) {
      setSpeechMessage(errorText(error))
    } finally {
      setSpeechBusy(false)
    }
  }

  async function setLocalApiEnabled(enabled: boolean): Promise<void> {
    setLocalApiBusy(true)
    setLocalApiMessage('')
    try {
      const result = await onSetLocalApiEnabled(enabled)
      if (!result.ok) setLocalApiMessage(result.error ?? 'Could not update the local API.')
      else setLocalApiMessage(enabled ? 'Local API is running.' : 'Local API stopped.')
    } catch (error) {
      setLocalApiMessage(errorText(error))
    } finally {
      setLocalApiBusy(false)
    }
  }

  async function copyLocalApiToken(): Promise<void> {
    if (!localApiStatus?.token) return
    try {
      await navigator.clipboard.writeText(localApiStatus.token)
      setLocalApiMessage('Bearer token copied.')
    } catch (error) {
      setLocalApiMessage(`Could not copy the token: ${errorText(error)}`)
    }
  }

  async function saveWebSearchKey(): Promise<void> {
    const key = webSearchKey.trim()
    if (!key) {
      setWebSearchMessage('Enter the Tavily API key, or leave the field blank to keep the current key.')
      return
    }
    setWebSearchBusy(true)
    setWebSearchMessage('')
    try {
      const result = await onUpdateWebSearchApiKey(key)
      if (!result.ok) setWebSearchMessage(result.error ?? 'Could not save the Tavily API key.')
      else {
        setWebSearchKey('')
        setWebSearchMessage('Web search is configured. Search requests still ask for approval.')
      }
    } catch (error) {
      setWebSearchMessage(errorText(error))
    } finally {
      setWebSearchBusy(false)
    }
  }

  async function clearWebSearchKey(): Promise<void> {
    setWebSearchBusy(true)
    setWebSearchMessage('')
    try {
      const result = await onUpdateWebSearchApiKey(null)
      if (!result.ok) setWebSearchMessage(result.error ?? 'Could not clear the Tavily API key.')
      else setWebSearchMessage('Web search key cleared.')
    } catch (error) {
      setWebSearchMessage(errorText(error))
    } finally {
      setWebSearchBusy(false)
    }
  }

  async function connectGoogleCalendar(): Promise<void> {
    const clientId = googleClientId.trim()
    if (!clientId) {
      setGoogleCalendarMessage('Enter a Google OAuth Client ID first.')
      return
    }
    setGoogleCalendarBusy(true)
    setGoogleCalendarMessage('Opening Google sign-in…')
    try {
      const saved = await onUpdateGoogleCalendarClientId(clientId)
      if (!saved.ok) {
        setGoogleCalendarMessage(saved.error ?? 'Could not save the Google OAuth Client ID.')
        return
      }
      const connected = await onConnectGoogleCalendar()
      setGoogleCalendarMessage(connected.ok
        ? connected.message ?? 'Google Calendar connected.'
        : connected.error ?? 'Google Calendar sign-in did not complete.')
    } catch (error) {
      setGoogleCalendarMessage(errorText(error))
    } finally {
      setGoogleCalendarBusy(false)
    }
  }

  async function disconnectGoogleCalendar(): Promise<void> {
    setGoogleCalendarBusy(true)
    setGoogleCalendarMessage('')
    try {
      const result = await onDisconnectGoogleCalendar()
      setGoogleCalendarMessage(result.ok
        ? result.message ?? 'Google Calendar disconnected.'
        : result.error ?? 'Could not disconnect Google Calendar.')
    } catch (error) {
      setGoogleCalendarMessage(errorText(error))
    } finally {
      setGoogleCalendarBusy(false)
    }
  }

  function requestGoogleGmailConnection(): void {
    if (!googleGmailClientId.trim()) {
      setGoogleGmailMessage('Enter a Google OAuth Client ID first.')
      return
    }
    setGoogleGmailConsentOpen(true)
  }

  async function connectGoogleGmail(): Promise<void> {
    setGoogleGmailConsentOpen(false)
    const clientId = googleGmailClientId.trim()
    if (!clientId) {
      setGoogleGmailMessage('Enter a Google OAuth Client ID first.')
      return
    }
    setGoogleGmailBusy(true)
    setGoogleGmailMessage('Opening Google sign-in…')
    try {
      const saved = await onUpdateGoogleGmailClientId(clientId)
      if (!saved.ok) {
        setGoogleGmailMessage(saved.error ?? 'Could not save the Google OAuth Client ID.')
        return
      }
      const connected = await onConnectGoogleGmail()
      setGoogleGmailMessage(connected.ok
        ? connected.message ?? 'Gmail connected.'
        : connected.error ?? 'Gmail sign-in did not complete.')
    } catch (error) {
      setGoogleGmailMessage(errorText(error))
    } finally {
      setGoogleGmailBusy(false)
    }
  }

  async function disconnectGoogleGmail(): Promise<void> {
    setGoogleGmailBusy(true)
    setGoogleGmailMessage('')
    try {
      const result = await onDisconnectGoogleGmail()
      setGoogleGmailMessage(result.ok
        ? result.message ?? 'Gmail disconnected.'
        : result.error ?? 'Could not disconnect Gmail.')
    } catch (error) {
      setGoogleGmailMessage(errorText(error))
    } finally {
      setGoogleGmailBusy(false)
    }
  }

  function requestGoogleDriveConnection(): void {
    if (!googleDriveClientId.trim()) {
      setGoogleDriveMessage('Enter a Google OAuth Client ID first.')
      return
    }
    setGoogleDriveConsentOpen(true)
  }

  async function connectGoogleDrive(): Promise<void> {
    setGoogleDriveConsentOpen(false)
    const clientId = googleDriveClientId.trim()
    if (!clientId) {
      setGoogleDriveMessage('Enter a Google OAuth Client ID first.')
      return
    }
    setGoogleDriveBusy(true)
    setGoogleDriveMessage('Opening Google sign-in…')
    try {
      const saved = await onUpdateGoogleDriveClientId(clientId)
      if (!saved.ok) {
        setGoogleDriveMessage(saved.error ?? 'Could not save the Google OAuth Client ID.')
        return
      }
      const connected = await onConnectGoogleDrive()
      setGoogleDriveMessage(connected.ok
        ? connected.message ?? 'Google Drive connected.'
        : connected.error ?? 'Google Drive sign-in did not complete.')
    } catch (error) {
      setGoogleDriveMessage(errorText(error))
    } finally {
      setGoogleDriveBusy(false)
    }
  }

  async function disconnectGoogleDrive(): Promise<void> {
    setGoogleDriveBusy(true)
    setGoogleDriveMessage('')
    try {
      const result = await onDisconnectGoogleDrive()
      setGoogleDriveMessage(result.ok
        ? result.message ?? 'Google Drive disconnected.'
        : result.error ?? 'Could not disconnect Google Drive.')
    } catch (error) {
      setGoogleDriveMessage(errorText(error))
    } finally {
      setGoogleDriveBusy(false)
    }
  }

  async function connectGoogleTasks(): Promise<void> {
    const clientId = googleTasksClientId.trim()
    if (!clientId) {
      setGoogleTasksMessage('Enter a Google OAuth Desktop Client ID first.')
      return
    }
    setGoogleTasksBusy(true)
    setGoogleTasksMessage('Opening Google sign-in…')
    try {
      const saved = await onUpdateGoogleTasksClientId(clientId)
      if (!saved.ok) {
        setGoogleTasksMessage(saved.error ?? 'Could not save the Google OAuth Client ID.')
        return
      }
      const connected = await onConnectGoogleTasks()
      setGoogleTasksMessage(connected.ok
        ? connected.message ?? 'Google Tasks connected.'
        : connected.error ?? 'Google sign-in did not complete.')
    } catch (error) {
      setGoogleTasksMessage(errorText(error))
    } finally {
      setGoogleTasksBusy(false)
    }
  }

  async function disconnectGoogleTasks(): Promise<void> {
    setGoogleTasksBusy(true)
    setGoogleTasksMessage('')
    try {
      const result = await onDisconnectGoogleTasks()
      setGoogleTasksMessage(result.ok
        ? result.message ?? 'Google Tasks disconnected in Mike Assist.'
        : result.error ?? 'Could not disconnect Google Tasks.')
    } catch (error) {
      setGoogleTasksMessage(errorText(error))
    } finally {
      setGoogleTasksBusy(false)
    }
  }

  return (
    <div className="settings">
      <section className="settings-section appearance-section">
        <div className="section-head">
          <h2>Appearance</h2>
          <p>Choose a color theme for this device. Your selection is saved locally.</p>
        </div>
        <fieldset className="theme-options">
          <legend className="visually-hidden">Color theme</legend>
          {APP_THEMES.map((option) => (
            <label className={`theme-option ${theme === option.id ? 'selected' : ''}`} key={option.id}>
              <input
                type="radio"
                name="app-theme"
                value={option.id}
                checked={theme === option.id}
                onChange={() => onThemeChange(option.id)}
              />
              <span className={`theme-swatch theme-swatch-${option.id}`} aria-hidden="true">
                <span className="theme-swatch-sidebar" />
                <span className="theme-swatch-main">
                  <span />
                  <span />
                </span>
              </span>
              <span className="theme-option-copy">
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </span>
              <span className="theme-option-check" aria-hidden="true">{theme === option.id ? 'Selected' : ''}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="settings-section">
        <div className="section-head">
          <h2>Model provider</h2>
          <p>Each request includes your message and the context the assistant uses. Loopback providers stay on this device; remote providers receive that content over the configured endpoint.</p>
        </div>

        <div className="form-grid">
          <label className="field">
            <span className="field-label">Preset</span>
            <select value={form.preset} onChange={(event) => choosePreset(event.target.value as FormState['preset'])}>
              {PROVIDER_PRESETS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field field-wide">
            <span className="field-label">Base URL</span>
            <input
              value={form.baseUrl}
              spellCheck={false}
              onChange={(event) => update('baseUrl', event.target.value)}
              placeholder="http://127.0.0.1:11434/v1"
            />
            <span className="field-hint">{preset.hint}</span>
          </label>

          <label className="field field-wide">
            <span className="field-label">Model</span>
            <input
              value={form.model}
              spellCheck={false}
              list="model-options"
              onChange={(event) => update('model', event.target.value)}
              placeholder="qwen2.5:3b"
            />
            <datalist id="model-options">
              {models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>

          <label className="field">
            <span className="field-label">Fast / helper model (optional)</span>
            <input
              value={form.fastModel}
              spellCheck={false}
              list="model-options"
              onChange={(event) => update('fastModel', event.target.value)}
              placeholder="Uses primary model if blank"
            />
            <span className="field-hint">Used for isolated delegated helper tasks.</span>
          </label>

          <label className="field">
            <span className="field-label">Vision model (optional)</span>
            <input
              value={form.visionModel}
              spellCheck={false}
              list="model-options"
              onChange={(event) => update('visionModel', event.target.value)}
              placeholder="Uses primary model if blank"
            />
            <span className="field-hint">Used automatically when a message includes images.</span>
          </label>

          <label className="field field-wide">
            <span className="field-label">Background tray mode</span>
            <input
              type="checkbox"
              checked={form.keepInBackground}
              onChange={(event) => update('keepInBackground', event.target.checked)}
            />
            <span className="field-hint">
              Keep Mike Assist running in the system tray when closing the window so scheduled tasks and reminders stay active.
            </span>
          </label>

          <label className="field">
            <span className="field-label">Context length</span>
            <input
              type="number"
              min={1024}
              max={131072}
              step={1024}
              value={form.contextLength}
              onChange={(event) => update('contextLength', Number(event.target.value))}
            />
            <span className="field-hint">Tokens. Ollama needs OLLAMA_CONTEXT_LENGTH set before it starts.</span>
          </label>

          <label className="field">
            <span className="field-label">Temperature</span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature}
              onChange={(event) => update('temperature', Number(event.target.value))}
            />
          </label>

          <label className="field">
            <span className="field-label">Max steps per request</span>
            <input
              type="number"
              min={1}
              max={16}
              step={1}
              value={form.maxSteps}
              onChange={(event) => update('maxSteps', Number(event.target.value))}
            />
            <span className="field-hint">A hard cap on tool-call rounds.</span>
          </label>

          <label className="field field-wide">
            <span className="field-label">
              API key
              {settings.provider.hasApiKey && (
                <span className="field-tag">
                  {settings.provider.apiKeyStored ? 'stored securely' : 'session only'}
                </span>
              )}
            </span>
            <input
              type="password"
              value={form.apiKey}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => update('apiKey', event.target.value)}
              placeholder={
                settings.provider.hasApiKey
                  ? 'Leave blank to keep the current key'
                  : 'Only needed for remote providers'
              }
            />
          </label>
        </div>

        <div className="settings-actions">
          <button className="primary-button" type="button" onClick={save} disabled={saving || testing}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="ghost-button" type="button" onClick={test} disabled={saving || testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {settings.provider.hasApiKey && (
            <button className="ghost-button" type="button" onClick={clearKey} disabled={saving || testing}>
              Clear key
            </button>
          )}
          {status && (
            <span className={`settings-status ${status.ok ? 'status-ok' : 'status-error'}`} role={status.ok ? 'status' : 'alert'}>
              {status.text}
            </span>
          )}
        </div>
      </section>

      <section className="settings-section">
        <div className="section-head">
          <h2>Local OpenAI-compatible API</h2>
          <p>
            Connect another local client to Mike Assist. Requests can use your assistant tools and approved folders;
            write and external actions still appear here for approval. The server binds to this PC only and turns off
            when Mike Assist closes.
          </p>
        </div>

        {localApiStatus?.enabled ? (
          <div className="form-grid">
            <label className="field field-wide">
              <span className="field-label">Base URL</span>
              <input readOnly value={localApiStatus.baseUrl ?? ''} spellCheck={false} />
              <span className="field-hint">Use this URL and the configured model in an OpenAI-compatible client.</span>
            </label>
            <label className="field field-wide">
              <span className="field-label">Bearer token</span>
              <input readOnly type="password" value={localApiStatus.token ?? ''} autoComplete="off" />
              <span className="field-hint">Session-only token. Copy it into a trusted local client.</span>
            </label>
            <div className="field field-wide">
              <span className="field-label">Model</span>
              <code>{localApiStatus.model ?? settings.provider.model}</code>
            </div>
            <div className="settings-actions field-wide">
              <button className="ghost-button" type="button" onClick={() => void copyLocalApiToken()} disabled={localApiBusy || !localApiStatus.token}>
                Copy bearer token
              </button>
              <button className="ghost-button" type="button" onClick={() => void setLocalApiEnabled(false)} disabled={localApiBusy}>
                {localApiBusy ? 'Stopping…' : 'Stop local API'}
              </button>
            </div>
          </div>
        ) : (
          <div className="settings-actions">
            <button className="ghost-button" type="button" onClick={() => void setLocalApiEnabled(true)} disabled={localApiBusy || localApiStatus === null}>
              {localApiBusy ? 'Starting…' : 'Start local API'}
            </button>
          </div>
        )}
        {localApiMessage && <p className="settings-status" role="status">{localApiMessage}</p>}
        {localApiStatus === null && <p className="field-hint">Checking local API status…</p>}
      </section>

      <section className="settings-section">
        <div className="section-head">
          <h2>Approved folders</h2>
          <p>
            Mike Assist can only read or write inside these folders. Removing one never deletes files
            — it only revokes access.
          </p>
        </div>

        <div className="grant-list">
          {grants.map((grant) => (
            <div className="grant-row" key={grant.id}>
              <div className="grant-main">
                <div className="grant-label">
                  {grant.label}
                  {grant.builtIn && <span className="field-tag">primary</span>}
                </div>
                <code className="grant-path" title={grant.root}>
                  {grant.root}
                </code>
              </div>

              <div className="grant-actions">
                <select
                  className="access-select"
                  value={grant.access}
                  disabled={grant.builtIn || grantBusy}
                  aria-label={`Access for ${grant.label}`}
                  onChange={(event) => void changeAccess(grant.id, event.target.value as Access)}
                >
                  <option value="read">Read only</option>
                  <option value="read-write">Read and write</option>
                </select>

                {!grant.builtIn && (
                  <button
                    className={`danger-button ${confirming === grant.id ? 'confirming' : ''}`}
                    type="button"
                    disabled={grantBusy}
                    onClick={() => void remove(grant.id)}
                  >
                    {confirming === grant.id ? 'Confirm remove' : 'Remove'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="grant-add">
          <select
            value={newAccess}
            onChange={(event) => setNewAccess(event.target.value as Access)}
            aria-label="Access level for the new folder"
          >
            <option value="read">Read only</option>
            <option value="read-write">Read and write</option>
          </select>
          <button className="ghost-button" type="button" onClick={addFolder} disabled={grantBusy}>
            Add folder…
          </button>
          {grantError && <span className="settings-status status-error" role="alert">{grantError}</span>}
        </div>
      </section>

      <section className="settings-section">
        <div className="section-head">
          <h2>Web domain allowlist</h2>
          <p>
            Web fetch and the visible browser can use only exact HTTPS domains you add here. Page text, links, and form actions require one-time approval in the browser; filling a field does not submit it, and password fields are unavailable to the assistant.
            Non-HTTPS URLs, unlisted requests, and domains that resolve to private network addresses are blocked. Browser HTTPS traffic is tunneled to the checked public IP, while cookies and storage stay in memory and clear when the browser window closes.
          </p>
        </div>

        <div className="domain-list">
          {allowedDomains.length === 0 && <span className="muted">No domains allowed. Web fetch and browser automation are disabled.</span>}
          {allowedDomains.map((host) => (
            <div className="domain-row" key={host}>
              <code>{host}</code>
              <button
                className="danger-button"
                type="button"
                disabled={domainBusy}
                onClick={() => void removeDomain(host)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="domain-add">
          <input
            value={domainInput}
            onChange={(event) => setDomainInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addDomain()
            }}
            placeholder="example.com"
            aria-label="HTTPS domain to allow"
            spellCheck={false}
          />
          <button className="ghost-button" type="button" onClick={addDomain} disabled={domainBusy || !domainInput.trim()}>
            {domainBusy ? 'Saving…' : 'Allow domain'}
          </button>
          {domainError && <span className="settings-status status-error" role="alert">{domainError}</span>}
        </div>
      </section>

      <section className="settings-section">
        <div className="section-head">
          <h2>Web search</h2>
          <p>
            Mike Assist uses Tavily to discover sources. Your query and API key go to Tavily only after you approve each search;
            searches may use credits under your Tavily plan. Search results are untrusted, and opening a result with web fetch
            still requires its exact domain in the allowlist. Read the <a href="https://docs.tavily.com/documentation/api-reference/endpoint/search" target="_blank" rel="noreferrer">Tavily Search API documentation</a>.
          </p>
        </div>

        {webSearchSettings ? (
          <div className="web-search-settings">
            <label className="field field-wide">
              <span className="field-label">
                Tavily API key
                {webSearchSettings.hasApiKey && (
                  <span className="field-tag">{webSearchSettings.apiKeyStored ? 'stored securely' : 'session only'}</span>
                )}
              </span>
              <input
                type="password"
                value={webSearchKey}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setWebSearchKey(event.target.value)}
                placeholder={webSearchSettings.hasApiKey ? 'Leave blank to keep the current key' : 'Paste your Tavily API key'}
              />
              <span className="field-hint">The saved key is never returned to the renderer. If OS encryption is unavailable, it is kept for this app session only.</span>
            </label>
            <div className="settings-actions">
              <button className="primary-button" type="button" onClick={() => void saveWebSearchKey()} disabled={webSearchBusy || !webSearchKey.trim()}>
                {webSearchBusy ? 'Saving…' : 'Save key'}
              </button>
              {webSearchSettings.hasApiKey && (
                <button className="ghost-button" type="button" onClick={() => void clearWebSearchKey()} disabled={webSearchBusy}>
                  Clear key
                </button>
              )}
              {webSearchMessage && <span className="settings-status" role="status">{webSearchMessage}</span>}
            </div>
          </div>
        ) : (
          <p className="muted">Loading web search settings…</p>
        )}
      </section>

      <section className="settings-section">
        <div className="section-head">
          <h2>Google Calendar</h2>
          <p>
            Connect your primary calendar with a Google OAuth Desktop Client ID. Google will ask you to sign in in your system browser.
            Mike Assist requests the <code>calendar.events.owned</code> scope; Google describes this as access to view, create, change, and delete events on calendars you own. Mike Assist exposes read, create, and update actions only; each action requires approval, and it never adds guests or sends guest notifications. The refresh token is encrypted with OS storage when available. Disconnecting clears it locally; remove Mike Assist in your Google Account to revoke the project grant, which can also disconnect Gmail, Drive, or Tasks.
          </p>
        </div>

        {googleCalendarSettings ? (
          <div className="web-search-settings">
            <label className="field field-wide">
              <span className="field-label">
                OAuth Desktop Client ID
                  {googleCalendarSettings.connected
                    ? <span className="field-tag">{googleCalendarSettings.tokenStored ? 'connected · encrypted' : 'connected · session only'}</span>
                    : googleCalendarSettings.tokenStored
                      ? <span className="field-tag">saved token unavailable</span>
                      : null}
              </span>
              <input
                value={googleClientId}
                autoComplete="off"
                spellCheck={false}
                disabled={googleCalendarSettings.connected || googleCalendarSettings.tokenStored || googleCalendarBusy}
                onChange={(event) => setGoogleClientId(event.target.value)}
                placeholder="1234567890-abc.apps.googleusercontent.com"
              />
              <span className="field-hint">
                Create a Desktop app OAuth client and enable the Google Calendar API in the same Google Cloud project. See the <a href="https://developers.google.com/identity/protocols/oauth2/native-app" target="_blank" rel="noreferrer">desktop OAuth setup guide</a> and <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Google Cloud OAuth clients</a>. The Client ID is public; do not paste a client secret.
              </span>
              {googleCalendarSettings.tokenStored && !googleCalendarSettings.connected && (
                <span className="field-hint">Mike Assist could not unlock this saved token. Reconnect with this Client ID, or clear the saved token below and connect again.</span>
              )}
            </label>
            <div className="settings-actions">
              {googleCalendarSettings.connected ? (
                <button className="danger-button" type="button" onClick={() => void disconnectGoogleCalendar()} disabled={googleCalendarBusy}>
                  {googleCalendarBusy ? 'Disconnecting…' : 'Disconnect locally'}
                </button>
              ) : googleCalendarSettings.tokenStored ? (
                <>
                  <button className="primary-button" type="button" onClick={() => void connectGoogleCalendar()} disabled={googleCalendarBusy || !googleClientId.trim()}>
                    {googleCalendarBusy ? 'Waiting for sign-in…' : 'Reconnect Google Calendar'}
                  </button>
                  <button className="danger-button" type="button" onClick={() => void disconnectGoogleCalendar()} disabled={googleCalendarBusy}>
                    {googleCalendarBusy ? 'Clearing…' : 'Clear saved token'}
                  </button>
                </>
              ) : (
                <button className="primary-button" type="button" onClick={() => void connectGoogleCalendar()} disabled={googleCalendarBusy || !googleClientId.trim()}>
                  {googleCalendarBusy ? 'Waiting for sign-in…' : 'Connect Google Calendar'}
                </button>
              )}
              {googleCalendarMessage && <span className="settings-status" role="status">{googleCalendarMessage}</span>}
            </div>
          </div>
        ) : (
          <p className="muted">Loading Google Calendar settings…</p>
        )}
      </section>
      <section className="settings-section">
        <div className="section-head">
          <h2>Gmail</h2>
          <p>
            Connect one Gmail account using a Google OAuth Desktop Client ID with the Gmail API enabled. Mike Assist requests read-only and compose access; every search, read, and draft asks first, and sending also requires typing <strong>SEND</strong>. The app cannot delete, archive, or label mail and does not open attachments. When you approve a Gmail action, its relevant content is sent to your configured model provider, which may be remote. Gmail results and the assistant reply stay in memory for the current session and are not saved to chat history. Use of Google Workspace data is limited to these visible Gmail features and follows Google’s Limited Use requirements. Refresh tokens are encrypted with OS storage when available. Disconnecting clears the token locally; remove Mike Assist in your Google Account to revoke the project grant, which can also disconnect Calendar, Drive, or Tasks.
          </p>
        </div>

        {googleGmailSettings ? (
          <div className="web-search-settings">
            <label className="field field-wide">
              <span className="field-label">
                OAuth Desktop Client ID
                {googleGmailSettings.connected
                  ? <span className="field-tag">{googleGmailSettings.tokenStored ? 'connected · encrypted' : 'connected · session only'}</span>
                  : googleGmailSettings.tokenStored
                    ? <span className="field-tag">saved token unavailable</span>
                    : null}
              </span>
              <input
                value={googleGmailClientId}
                autoComplete="off"
                spellCheck={false}
                disabled={googleGmailSettings.connected || googleGmailSettings.tokenStored || googleGmailBusy}
                onChange={(event) => setGoogleGmailClientId(event.target.value)}
                placeholder="1234567890-abc.apps.googleusercontent.com"
              />
              <span className="field-hint">
                The same Desktop Client ID used for Google Calendar can be reused if Gmail API is enabled in that Cloud project. See the <a href="https://developers.google.com/identity/protocols/oauth2/native-app" target="_blank" rel="noreferrer">desktop OAuth setup guide</a>, <a href="https://developers.google.com/workspace/gmail/api/auth/scopes" target="_blank" rel="noreferrer">Gmail permissions</a>, and <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Google Cloud OAuth clients</a>. The Client ID is public; do not paste a client secret.
              </span>
              {googleGmailSettings.tokenStored && !googleGmailSettings.connected && (
                <span className="field-hint">Mike Assist could not unlock this saved token. Reconnect with this Client ID, or clear the saved token and connect again.</span>
              )}
            </label>
            <div className="settings-actions">
              {googleGmailSettings.connected ? (
                <button className="danger-button" type="button" onClick={() => void disconnectGoogleGmail()} disabled={googleGmailBusy}>
                  {googleGmailBusy ? 'Disconnecting…' : 'Disconnect locally'}
                </button>
              ) : googleGmailSettings.tokenStored ? (
                <>
                  <button className="primary-button" type="button" onClick={requestGoogleGmailConnection} disabled={googleGmailBusy || !googleGmailClientId.trim()}>
                    {googleGmailBusy ? 'Waiting for sign-in…' : 'Reconnect Gmail'}
                  </button>
                  <button className="danger-button" type="button" onClick={() => void disconnectGoogleGmail()} disabled={googleGmailBusy}>
                    {googleGmailBusy ? 'Clearing…' : 'Clear saved token'}
                  </button>
                </>
              ) : (
                <button className="primary-button" type="button" onClick={requestGoogleGmailConnection} disabled={googleGmailBusy || !googleGmailClientId.trim()}>
                  {googleGmailBusy ? 'Waiting for sign-in…' : 'Connect Gmail'}
                </button>
              )}
              {googleGmailMessage && <span className="settings-status" role="status">{googleGmailMessage}</span>}
            </div>
          </div>
        ) : (
          <p className="muted">Loading Gmail settings…</p>
        )}
      </section>
      <section className="settings-section">
        <div className="section-head">
          <h2>Google Drive</h2>
          <p>
            Connect one Google Drive account with the read-only <code>drive.readonly</code> permission. Google grants access to Drive files broadly; Mike Assist still asks before each search or file read. Approved file extracts and assistant replies may be sent to your configured model provider and saved in chat history. The app reads Docs, Sheets, Slides, PDF, DOCX, XLSX, and supported text files; it does not edit or delete Drive files. Refresh tokens are encrypted with OS storage when available. Disconnecting clears the token locally; remove Mike Assist in your Google Account to revoke the project grant, which can also disconnect Calendar, Gmail, or Tasks. Public OAuth apps using this restricted scope need Google verification; Google requires a security assessment if restricted Drive data is stored or sent through servers.
          </p>
        </div>
        {googleDriveSettings ? (
          <div className="web-search-settings">
            <label className="field field-wide">
              <span className="field-label">
                OAuth Desktop Client ID
                {googleDriveSettings.connected
                  ? <span className="field-tag">{googleDriveSettings.tokenStored ? 'connected · encrypted' : 'connected · session only'}</span>
                  : googleDriveSettings.tokenStored
                    ? <span className="field-tag">saved token unavailable</span>
                    : null}
              </span>
              <input
                value={googleDriveClientId}
                autoComplete="off"
                spellCheck={false}
                disabled={googleDriveSettings.connected || googleDriveSettings.tokenStored || googleDriveBusy}
                onChange={(event) => setGoogleDriveClientId(event.target.value)}
                placeholder="1234567890-abc.apps.googleusercontent.com"
              />
              <span className="field-hint">
                Use the Desktop Client ID from the same Google Cloud project where you enable the Drive API. See the <a href="https://developers.google.com/identity/protocols/oauth2/native-app" target="_blank" rel="noreferrer">desktop OAuth setup guide</a>, <a href="https://developers.google.com/workspace/drive/api/guides/api-specific-auth" target="_blank" rel="noreferrer">Drive permissions</a>, and <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Google Cloud OAuth clients</a>. The Client ID is public; do not paste a client secret.
              </span>
              {googleDriveSettings.tokenStored && !googleDriveSettings.connected && (
                <span className="field-hint">Mike Assist could not unlock this saved token. Reconnect with this Client ID, or clear the saved token and connect again.</span>
              )}
            </label>
            <div className="settings-actions">
              {googleDriveSettings.connected ? (
                <button className="danger-button" type="button" onClick={() => void disconnectGoogleDrive()} disabled={googleDriveBusy}>
                  {googleDriveBusy ? 'Disconnecting…' : 'Disconnect locally'}
                </button>
              ) : googleDriveSettings.tokenStored ? (
                <>
                  <button className="primary-button" type="button" onClick={requestGoogleDriveConnection} disabled={googleDriveBusy || !googleDriveClientId.trim()}>
                    {googleDriveBusy ? 'Waiting for sign-in…' : 'Reconnect Google Drive'}
                  </button>
                  <button className="danger-button" type="button" onClick={() => void disconnectGoogleDrive()} disabled={googleDriveBusy}>
                    {googleDriveBusy ? 'Clearing…' : 'Clear saved token'}
                  </button>
                </>
              ) : (
                <button className="primary-button" type="button" onClick={requestGoogleDriveConnection} disabled={googleDriveBusy || !googleDriveClientId.trim()}>
                  {googleDriveBusy ? 'Waiting for sign-in…' : 'Connect Google Drive'}
                </button>
              )}
              {googleDriveMessage && <span className="settings-status" role="status">{googleDriveMessage}</span>}
            </div>
          </div>
        ) : (
          <p className="muted">Loading Google Drive settings…</p>
        )}
      </section>
      <section className="settings-section">
        <div className="section-head">
          <h2>Google Tasks</h2>
          <p>
            Connect one Google account with the read-only <code>tasks.readonly</code> permission. Mike Assist only lists your task lists and open tasks; it cannot create, edit, or complete them. Loading a list or task page asks for approval each time. The Today panel displays results locally; if you use these tools in Chat, approved task details may be sent to your configured model provider and saved in chat history. The refresh token is encrypted with OS storage when available. Disconnecting here clears Mike Assist’s saved token; Google keeps the authorization active until you remove it in your Google Account, because revoking a shared Google project can affect other connected services.
          </p>
        </div>
        {googleTasksSettings ? (
          <div className="web-search-settings">
            <label className="field field-wide">
              <span className="field-label">
                OAuth Desktop Client ID
                {googleTasksSettings.connected
                  ? <span className="field-tag">{googleTasksSettings.tokenStored ? 'connected · encrypted' : 'connected · session only'}</span>
                  : googleTasksSettings.tokenStored
                    ? <span className="field-tag">saved token unavailable</span>
                    : null}
              </span>
              <input
                value={googleTasksClientId}
                autoComplete="off"
                spellCheck={false}
                disabled={googleTasksSettings.connected || googleTasksSettings.tokenStored || googleTasksBusy}
                onChange={(event) => setGoogleTasksClientId(event.target.value)}
                placeholder="1234567890-abc.apps.googleusercontent.com"
              />
              <span className="field-hint">
                Enable the Google Tasks API in the same Cloud project as this Desktop Client ID. See the <a href="https://developers.google.com/identity/protocols/oauth2/native-app" target="_blank" rel="noreferrer">desktop OAuth guide</a>, <a href="https://developers.google.com/workspace/tasks/auth" target="_blank" rel="noreferrer">Tasks permissions</a>, and <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Google Cloud OAuth clients</a>. The Client ID is public; do not paste a client secret.
              </span>
              {googleTasksSettings.tokenStored && !googleTasksSettings.connected && (
                <span className="field-hint">Mike Assist could not unlock this saved token. Reconnect with this Client ID, or clear the saved connection and connect again.</span>
              )}
            </label>
            <div className="settings-actions">
              {googleTasksSettings.connected ? (
                <button className="danger-button" type="button" onClick={() => void disconnectGoogleTasks()} disabled={googleTasksBusy}>
                  {googleTasksBusy ? 'Disconnecting…' : 'Disconnect in Mike Assist'}
                </button>
              ) : googleTasksSettings.tokenStored ? (
                <>
                  <button className="primary-button" type="button" onClick={() => void connectGoogleTasks()} disabled={googleTasksBusy || !googleTasksClientId.trim()}>
                    {googleTasksBusy ? 'Waiting for sign-in…' : 'Reconnect Google Tasks'}
                  </button>
                  <button className="danger-button" type="button" onClick={() => void disconnectGoogleTasks()} disabled={googleTasksBusy}>
                    {googleTasksBusy ? 'Clearing…' : 'Clear saved connection'}
                  </button>
                </>
              ) : (
                <button className="primary-button" type="button" onClick={() => void connectGoogleTasks()} disabled={googleTasksBusy || !googleTasksClientId.trim()}>
                  {googleTasksBusy ? 'Waiting for sign-in…' : 'Connect Google Tasks'}
                </button>
              )}
              {googleTasksMessage && <span className="settings-status" role="status">{googleTasksMessage}</span>}
            </div>
          </div>
        ) : (
          <p className="muted">Loading Google Tasks settings…</p>
        )}
      </section>
      <McpPanel />

      <section className="settings-section">
        <div className="section-head">
          <h2>Backup &amp; Restore</h2>
          <p>
            Create or restore a consistent snapshot of chats, finance records, memory facts, research, vault documents, Today plans,
            saved workflows and Skills, coaching profile and journal, voice settings, provider settings, folder grants, allowed domains,
            MCP connections, Google Calendar, Gmail, Google Drive, and Google Tasks connection settings, and the audit log. Optionally provide a
            passphrase to encrypt the snapshot with AES-256-GCM.
          </p>
        </div>
        <label className="field field-wide">
          <span className="field-label">Encryption passphrase (optional)</span>
          <input
            type="password"
            value={backupPassphrase}
            onChange={(event) => setBackupPassphrase(event.target.value)}
            placeholder="Leave blank for unencrypted folder snapshot, or enter passphrase to encrypt / decrypt"
            autoComplete="off"
          />
        </label>
        <div className="settings-actions">
          <button className="ghost-button" type="button" onClick={() => void createBackup()} disabled={backupBusy}>
            {backupBusy ? 'Working…' : 'Create backup…'}
          </button>
          {onRestoreBackup && (
            <button className="ghost-button" type="button" onClick={() => void restoreBackup()} disabled={backupBusy}>
              Restore from backup…
            </button>
          )}
          {backupMessage && <span className="settings-status" role="status">{backupMessage}</span>}
        </div>
      </section>

      <section className="settings-section">
        <div className="section-head">
          <h2>Voice input (optional)</h2>
          <p>
            Voice recordings are sent only to a transcription endpoint on this computer. Mike Assist
            does not install or start speech software for you.
          </p>
        </div>
        <label className="field field-wide">
          <span className="field-label">Local transcription URL</span>
          <input
            value={speechInput}
            onChange={(event) => setSpeechInput(event.target.value)}
            placeholder="http://127.0.0.1:8080/v1/audio/transcriptions"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="field-hint">Loopback hosts only. Leave blank to disable voice input.</span>
        </label>
        <div className="settings-actions">
          <button className="ghost-button" type="button" onClick={() => void saveSpeechEndpoint()} disabled={speechBusy}>
            {speechBusy ? 'Saving…' : 'Save voice endpoint'}
          </button>
          {speechMessage && <span className="settings-status" role="status">{speechMessage}</span>}
        </div>
      </section>

      {googleGmailConsentOpen && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="gmail-consent-title" aria-describedby="gmail-consent-copy">
            <div className="modal-top">
              <span className="modal-kicker"><span className="shield-dot" /> Gmail data use</span>
            </div>
            <h2 id="gmail-consent-title">Before connecting Gmail</h2>
            <p id="gmail-consent-copy" className="modal-summary">
              Mike Assist will request permission to read your messages and create or send mail. When you approve a Gmail action, the relevant email content is sent to your configured model provider, which may be a remote service. Gmail results and the assistant’s reply stay in memory for this session and are not saved to local chat history. Search, read, and draft actions each need approval; sending also requires you to type SEND. Disconnecting in Settings clears the token locally; removing Mike Assist in your Google Account revokes the project grant for connected services.
            </p>
            <p className="field-hint">
              Google Workspace data is used only for the Gmail features shown in Mike Assist and is handled under Google’s Limited Use requirements. Read the <a href="https://developers.google.com/workspace/workspace-api-user-data-developer-policy" target="_blank" rel="noreferrer">Google Workspace User Data Policy</a>.
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setGoogleGmailConsentOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void connectGoogleGmail()} disabled={googleGmailBusy}>
                Continue to Google sign-in
              </button>
            </div>
          </section>
        </div>
      )}
      {googleDriveConsentOpen && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="drive-consent-title" aria-describedby="drive-consent-copy">
            <div className="modal-top">
              <span className="modal-kicker"><span className="shield-dot" /> Google Drive data use</span>
            </div>
            <h2 id="drive-consent-title">Before connecting Google Drive</h2>
            <p id="drive-consent-copy" className="modal-summary">
              Google will grant Mike Assist read-only access to Drive files broadly. Search and file reads each ask for approval. If approved, file names and selected text extracts are sent to your configured model provider, which may be remote, and can be stored in chat history. Mike Assist cannot edit or delete Drive files. Disconnecting in Settings clears the token locally; removing Mike Assist in your Google Account revokes the project grant for connected services.
            </p>
            <p className="field-hint">
              Google classifies this as a restricted Drive scope. Public OAuth apps using it need verification; sending or storing restricted Drive data through servers requires a security assessment. See the <a href="https://developers.google.com/workspace/drive/api/guides/api-specific-auth" target="_blank" rel="noreferrer">scope guidance</a>.
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setGoogleDriveConsentOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void connectGoogleDrive()} disabled={googleDriveBusy}>
                Continue to Google sign-in
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function toForm(settings: PublicSettings): FormState {
  return {
    preset: settings.provider.preset,
    baseUrl: settings.provider.baseUrl,
    model: settings.provider.model,
    fastModel: settings.provider.fastModel ?? '',
    visionModel: settings.provider.visionModel ?? '',
    keepInBackground: Boolean(settings.provider.keepInBackground),
    contextLength: settings.provider.contextLength,
    temperature: settings.provider.temperature,
    maxSteps: settings.provider.maxSteps,
    apiKey: ''
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
