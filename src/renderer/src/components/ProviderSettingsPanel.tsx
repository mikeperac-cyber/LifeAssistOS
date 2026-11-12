import { useEffect, useState } from 'react'
import type { SettingsPatch, PublicSettings } from '../../../shared/ipc'
import { PROVIDER_PRESETS, presetFor } from '../../../shared/presets'
import { isLoopbackProviderEndpoint, normalizeProviderEndpoint } from '../../../shared/provider-endpoint'

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

export function ProviderSettingsPanel({
  settings,
  onSettingsUpdated
}: {
  settings: PublicSettings
  onSettingsUpdated: (settings: PublicSettings) => void
}): React.JSX.Element {
  const [form, setForm] = useState<FormState>(() => toForm(settings))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [openRouterSigningIn, setOpenRouterSigningIn] = useState(false)
  const [removingCredential, setRemovingCredential] = useState<string | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [models, setModels] = useState<string[]>([])

  useEffect(() => setForm(toForm(settings)), [settings])

  const preset = presetFor(form.preset)
  const existingKeyMatchesForm = settings.provider.preset === form.preset &&
    sameEndpointOrigin(settings.provider.baseUrl, form.baseUrl)
  const savedCredentialForForm = settings.provider.savedCredentials.find((credential) =>
    credential.preset === form.preset && sameEndpointOrigin(credential.origin, form.baseUrl)
  )
  const hasSavedKeyForForm = Boolean(savedCredentialForForm) || (existingKeyMatchesForm && settings.provider.hasApiKey)
  const savedKeyIsSecure = savedCredentialForForm?.storedSecurely ?? (existingKeyMatchesForm && settings.provider.apiKeyStored)
  const savedProviderCount = new Set(settings.provider.savedCredentials.map((credential) => credential.preset)).size

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function choosePreset(id: FormState['preset']): void {
    const next = presetFor(id)
    setModels([])
    setStatus(null)
    setForm((current) => ({
      ...current,
      preset: id,
      baseUrl: next.baseUrl,
      model: next.model || current.model,
      apiKey: id === current.preset ? current.apiKey : ''
    }))
  }

  function buildPatch(): SettingsPatch {
    const patch: SettingsPatch = {
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
    if (form.apiKey.trim()) patch.apiKey = form.apiKey.trim()
    return patch
  }

  async function persist(patch: SettingsPatch): Promise<PublicSettings> {
    const result = await window.assist.updateSettings(patch)
    if (!result.ok) throw new Error(result.error ?? 'Could not save provider settings.')
    const latest = result.settings ?? await window.assist.getSettings()
    onSettingsUpdated(latest)
    setForm(toForm(latest))
    return latest
  }

  async function save(): Promise<void> {
    setSaving(true)
    setStatus(null)
    try {
      const latest = await persist(buildPatch())
      const keyNotice = latest.provider.hasApiKey
        ? latest.provider.apiKeyStored ? ' The key is stored securely.' : ' The key is available for this session only.'
        : ''
      setStatus({ ok: true, text: `Provider settings saved.${keyNotice}` })
    } catch (error) {
      setStatus({ ok: false, text: errorText(error) })
    } finally {
      setSaving(false)
    }
  }

  async function testConnection(): Promise<void> {
    setTesting(true)
    setStatus(null)
    setModels([])
    try {
      await persist(buildPatch())
      const result = await window.assist.testProvider()
      setStatus({ ok: result.ok, text: result.message })
      setModels([...new Set((result.models ?? []).filter((model) => model.trim()))]
        .sort((first, second) => first.localeCompare(second, undefined, { numeric: true, sensitivity: 'base' })))
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
      await persist({ apiKey: null })
      setStatus({ ok: true, text: 'API key cleared.' })
    } catch (error) {
      setStatus({ ok: false, text: errorText(error) })
    } finally {
      setSaving(false)
    }
  }

  async function removeCredential(credential: PublicSettings['provider']['savedCredentials'][number]): Promise<void> {
    const id = `${credential.preset}-${credential.origin}`
    setRemovingCredential(id)
    setStatus(null)
    try {
      const result = await window.assist.removeProviderCredential(credential.preset, credential.origin)
      if (!result.ok || !result.settings) throw new Error(result.error ?? 'Could not remove this provider key.')
      onSettingsUpdated(result.settings)
      if (result.settings.provider.preset === credential.preset && sameEndpointOrigin(result.settings.provider.baseUrl, credential.origin)) {
        setForm(toForm(result.settings))
      }
      setStatus({ ok: true, text: `${presetFor(credential.preset).label} key removed.` })
    } catch (error) {
      setStatus({ ok: false, text: errorText(error) })
    } finally {
      setRemovingCredential(null)
    }
  }

  async function signInToOpenRouter(): Promise<void> {
    if (form.preset !== 'openrouter' || !isOfficialOpenRouterEndpoint(form.baseUrl) || saving || testing || openRouterSigningIn) return
    setOpenRouterSigningIn(true)
    setStatus({ ok: true, text: 'Waiting for OpenRouter approval in your browser…' })
    let accountConnected = false
    try {
      const result = await window.assist.connectOpenRouter()
      if (!result.ok) throw new Error(result.error)
      accountConnected = true

      // Keep the prior provider active until approval succeeds. The credential
      // is already saved per-provider, so switching now restores that saved key.
      const patch = buildPatch()
      delete patch.apiKey
      const latest = await persist(patch)
      setForm(toForm(latest))
      setStatus({ ok: true, text: result.storedSecurely
        ? 'OpenRouter is connected. Its key is encrypted on this device.'
        : 'OpenRouter is connected for this session. Secure storage is unavailable.' })
    } catch (error) {
      setStatus({ ok: false, text: accountConnected
        ? `OpenRouter connected, but the provider settings could not be activated: ${errorText(error)}`
        : errorText(error) })
    } finally {
      setOpenRouterSigningIn(false)
    }
  }

  async function cancelOpenRouterSignIn(): Promise<void> {
    try { await window.assist.cancelOpenRouterSignIn() }
    catch { setStatus({ ok: false, text: 'Could not cancel OpenRouter sign-in. Close the browser page or wait for it to time out.' }) }
  }

  return (
    <section className="settings-section" aria-labelledby="provider-settings-title">
      <div className="section-head">
        <h2 id="provider-settings-title">AI provider</h2>
      <p>Choose the provider and model for coaching, learning, and task help. Hosted providers receive only the conversation or task details included in each request.</p>
      </div>

      <div className="form-grid">
        <label className="field field-wide">
          <span className="field-label">Provider</span>
          <select value={form.preset} disabled={openRouterSigningIn} onChange={(event) => choosePreset(event.target.value as FormState['preset'])}>
            <optgroup label="API providers">
              {PROVIDER_PRESETS.filter((option) => option.needsKey).map((option) => <option key={option.id} value={option.id}>{option.label}{settings.provider.savedCredentials.some((credential) => credential.preset === option.id) ? ' · Key saved' : ''}</option>)}
            </optgroup>
            <optgroup label="Local providers">
              {PROVIDER_PRESETS.filter((option) => option.id === 'ollama' || option.id === 'lmstudio').map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </optgroup>
            <optgroup label="Custom">
              {PROVIDER_PRESETS.filter((option) => option.id === 'custom').map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </optgroup>
          </select>
          <span className="field-hint">{preset.hint}</span>
        </label>

        <div className="field field-wide provider-saved-summary" aria-label="Saved AI provider connections">
          <div className="provider-saved-summary-copy">
            <strong>{savedProviderCount ? `${savedProviderCount} provider${savedProviderCount === 1 ? '' : 's'} with saved keys` : 'No provider keys saved yet'}</strong>
            <span>Keys stay tied to their provider endpoint. Only the selected provider receives your AI requests.</span>
          </div>
          <div className="provider-saved-list">
            {settings.provider.savedCredentials.map((credential) => {
              const providerName = presetFor(credential.preset).label
              const id = `${credential.preset}-${credential.origin}`
              return <span className={`provider-saved-chip ${credential.storedSecurely ? '' : 'session-only'}`} key={id}>
                <span className="provider-saved-chip-copy"><strong>{providerName}</strong><small>{new URL(credential.origin).hostname} · {credential.storedSecurely ? 'encrypted on device' : 'this session only'}</small></span>
                <button className="provider-credential-remove" type="button" onClick={() => void removeCredential(credential)} disabled={saving || testing || openRouterSigningIn || removingCredential !== null} aria-label={`Remove saved ${providerName} key for ${new URL(credential.origin).hostname}`}>
                  {removingCredential === id ? 'Removing…' : 'Remove'}
                </button>
              </span>
            })}
          </div>
        </div>

        {settings.provider.credentialReentryRequired && (
          <p className="field-hint" role="status">
            An older API key was removed because it could not be safely tied to a provider endpoint. Check the endpoint above, then enter the key again for the provider you trust.
          </p>
        )}

        {form.preset === 'openrouter' && isOfficialOpenRouterEndpoint(form.baseUrl) && (
          <div className="field-wide openrouter-auth-option">
            <div>
              <strong>Use your OpenRouter account</strong>
              <p>Sign in in your browser. LifeAssistOS receives a user-controlled API key, never your OpenRouter password.</p>
            </div>
            <div className="openrouter-auth-actions">
              <button className="ghost-button" type="button" onClick={() => void signInToOpenRouter()} disabled={saving || testing || openRouterSigningIn}>
                {openRouterSigningIn ? 'Waiting for approval…' : existingKeyMatchesForm && settings.provider.hasApiKey ? 'Reconnect OpenRouter' : 'Sign in with OpenRouter'}
              </button>
              {openRouterSigningIn && <button className="ghost-button" type="button" onClick={() => void cancelOpenRouterSignIn()}>Cancel</button>}
            </div>
          </div>
        )}

        <label className="field field-wide">
          <span className="field-label">API endpoint</span>
          <input value={form.baseUrl} disabled={openRouterSigningIn} onChange={(event) => update('baseUrl', event.target.value)} spellCheck={false} autoComplete="off" />
        </label>

        <label className="field field-wide">
          <span className="field-label">Model</span>
          <input value={form.model} disabled={openRouterSigningIn} onChange={(event) => update('model', event.target.value)} list="provider-model-options" autoComplete="off" />
          <datalist id="provider-model-options">{models.map((model) => <option key={model} value={model} />)}</datalist>
        </label>

        <label className="field field-wide">
          <span className="field-label">
            API key
            {hasSavedKeyForForm && <span className="field-tag">{savedKeyIsSecure ? 'stored securely' : 'session only'}</span>}
          </span>
          <input
            type="password"
            value={form.apiKey}
            disabled={openRouterSigningIn}
            autoComplete="new-password"
            spellCheck={false}
            onChange={(event) => update('apiKey', event.target.value)}
            placeholder={hasSavedKeyForForm ? 'Saved key is reused; enter a new key to replace it' : preset.needsKey ? `Enter ${preset.label} API key` : 'Optional for local or custom endpoints'}
          />
          <span className="field-hint">
            {hasSavedKeyForForm
              ? savedKeyIsSecure ? 'A key is saved for this provider and endpoint. Save to activate it; the key stays encrypted on this device.' : 'A key is available for this provider and endpoint in this session. Save to activate it.'
              : preset.needsKey
                ? 'No API key is saved for this provider. Enter one to enable hosted AI.'
                : isLoopbackProviderEndpoint(form.baseUrl)
                  ? 'This local endpoint does not require a key by default. Enter one if your server requires authentication.'
                  : 'No API key is saved for this endpoint. Enter one if it requires authentication.'}
          </span>
        </label>

        <details className="field field-wide provider-advanced-settings">
          <summary>Advanced provider settings</summary>
          <div className="form-grid">
            <label className="field"><span className="field-label">Fast model</span><input disabled={openRouterSigningIn} value={form.fastModel} onChange={(event) => update('fastModel', event.target.value)} /></label>
            <label className="field"><span className="field-label">Vision model</span><input disabled={openRouterSigningIn} value={form.visionModel} onChange={(event) => update('visionModel', event.target.value)} /></label>
            <label className="field"><span className="field-label">Context length</span><input disabled={openRouterSigningIn} type="number" min={1024} max={131072} step={1024} value={form.contextLength} onChange={(event) => update('contextLength', Number(event.target.value))} /></label>
            <label className="field"><span className="field-label">Temperature</span><input disabled={openRouterSigningIn} type="number" min={0} max={2} step={0.1} value={form.temperature} onChange={(event) => update('temperature', Number(event.target.value))} /></label>
            <label className="field"><span className="field-label">Maximum response steps</span><input disabled={openRouterSigningIn} type="number" min={1} max={16} step={1} value={form.maxSteps} onChange={(event) => update('maxSteps', Number(event.target.value))} /></label>
          </div>
        </details>
      </div>

      <div className="settings-actions">
        <button className="primary-button" type="button" onClick={() => void save()} disabled={saving || testing || openRouterSigningIn}>{saving ? 'Saving…' : 'Save provider'}</button>
        <button className="ghost-button" type="button" onClick={() => void testConnection()} disabled={saving || testing || openRouterSigningIn}>{testing ? 'Testing…' : 'Test connection & load models'}</button>
        {existingKeyMatchesForm && settings.provider.hasApiKey && <button className="ghost-button" type="button" onClick={() => void clearKey()} disabled={saving || testing || openRouterSigningIn}>Clear key</button>}
        {status && <span className={`settings-status ${status.ok ? 'status-ok' : 'status-error'}`} role={status.ok ? 'status' : 'alert'}>{status.text}</span>}
      </div>
    </section>
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

function sameEndpointOrigin(first: string, second: string): boolean {
  try {
    return new URL(normalizeProviderEndpoint(first)).origin === new URL(normalizeProviderEndpoint(second)).origin
  } catch {
    return false
  }
}

function isOfficialOpenRouterEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(normalizeProviderEndpoint(value))
    return endpoint.protocol === 'https:' && endpoint.origin === 'https://openrouter.ai' && endpoint.pathname.replace(/\/+$/, '') === '/api/v1'
  } catch { return false }
}
