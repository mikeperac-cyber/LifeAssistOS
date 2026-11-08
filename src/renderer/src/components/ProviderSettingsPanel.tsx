import { useEffect, useState } from 'react'
import type { SettingsPatch, PublicSettings } from '../../../shared/ipc'
import { PROVIDER_PRESETS, presetFor } from '../../../shared/presets'
import { normalizeProviderEndpoint } from '../../../shared/provider-endpoint'

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
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [models, setModels] = useState<string[]>([])

  useEffect(() => setForm(toForm(settings)), [settings])

  const preset = presetFor(form.preset)
  const existingKeyMatchesForm = settings.provider.preset === form.preset &&
    sameEndpointOrigin(settings.provider.baseUrl, form.baseUrl)

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

  return (
    <section className="settings-section" aria-labelledby="provider-settings-title">
      <div className="section-head">
        <h2 id="provider-settings-title">AI provider</h2>
        <p>Choose the provider and model used by AI task features. Hosted providers receive only the text and task details included in each request.</p>
      </div>

      <div className="form-grid">
        <label className="field field-wide">
          <span className="field-label">Provider</span>
          <select value={form.preset} onChange={(event) => choosePreset(event.target.value as FormState['preset'])}>
            <optgroup label="API providers">
              {PROVIDER_PRESETS.filter((option) => option.needsKey).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
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

        <label className="field field-wide">
          <span className="field-label">API endpoint</span>
          <input value={form.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} spellCheck={false} autoComplete="off" />
        </label>

        <label className="field field-wide">
          <span className="field-label">Model</span>
          <input value={form.model} onChange={(event) => update('model', event.target.value)} list="provider-model-options" autoComplete="off" />
          <datalist id="provider-model-options">{models.map((model) => <option key={model} value={model} />)}</datalist>
        </label>

        <label className="field field-wide">
          <span className="field-label">
            API key
            {existingKeyMatchesForm && settings.provider.hasApiKey && <span className="field-tag">{settings.provider.apiKeyStored ? 'stored securely' : 'session only'}</span>}
          </span>
          <input
            type="password"
            value={form.apiKey}
            autoComplete="new-password"
            spellCheck={false}
            onChange={(event) => update('apiKey', event.target.value)}
            placeholder={existingKeyMatchesForm && settings.provider.hasApiKey ? 'Saved key is reused; enter a new key to replace it' : preset.needsKey ? `Enter ${preset.label} API key` : 'Optional for local or custom endpoints'}
          />
          <span className="field-hint">
            {existingKeyMatchesForm && settings.provider.hasApiKey
              ? settings.provider.apiKeyStored ? 'Your encrypted key stays on this device and is reused automatically.' : 'This key is available for this session only because secure storage is unavailable.'
              : preset.needsKey ? 'The key is saved through the existing secure storage path. Enter it once; the app will reuse it.' : 'Leave blank for local endpoints that do not require authentication.'}
          </span>
        </label>

        <details className="field field-wide provider-advanced-settings">
          <summary>Advanced provider settings</summary>
          <div className="form-grid">
            <label className="field"><span className="field-label">Fast model</span><input value={form.fastModel} onChange={(event) => update('fastModel', event.target.value)} /></label>
            <label className="field"><span className="field-label">Vision model</span><input value={form.visionModel} onChange={(event) => update('visionModel', event.target.value)} /></label>
            <label className="field"><span className="field-label">Context length</span><input type="number" min={1024} max={131072} step={1024} value={form.contextLength} onChange={(event) => update('contextLength', Number(event.target.value))} /></label>
            <label className="field"><span className="field-label">Temperature</span><input type="number" min={0} max={2} step={0.1} value={form.temperature} onChange={(event) => update('temperature', Number(event.target.value))} /></label>
            <label className="field"><span className="field-label">Maximum response steps</span><input type="number" min={1} max={16} step={1} value={form.maxSteps} onChange={(event) => update('maxSteps', Number(event.target.value))} /></label>
          </div>
        </details>
      </div>

      <div className="settings-actions">
        <button className="primary-button" type="button" onClick={() => void save()} disabled={saving || testing}>{saving ? 'Saving…' : 'Save provider'}</button>
        <button className="ghost-button" type="button" onClick={() => void testConnection()} disabled={saving || testing}>{testing ? 'Testing…' : 'Test connection & load models'}</button>
        {existingKeyMatchesForm && settings.provider.hasApiKey && <button className="ghost-button" type="button" onClick={() => void clearKey()} disabled={saving || testing}>Clear key</button>}
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
