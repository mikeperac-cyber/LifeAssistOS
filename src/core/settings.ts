import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import type { AppSettings, ProviderSettings } from '../shared/types'
import { normalizeProviderEndpoint, safeProviderEndpointForDisplay } from '../shared/provider-endpoint'
import { readJsonStore } from './json-store'

/** Encrypts the API key at rest. In Electron this is backed by safeStorage. */
export interface SecretCodec {
  available: boolean
  encrypt(value: string): Promise<string>
  decrypt(value: string): Promise<{ value: string; shouldReEncrypt?: boolean }>
}

const providerSchema = z.object({
  preset: z.enum([
    'openai', 'anthropic', 'gemini', 'openrouter', 'groq', 'deepseek', 'mistral', 'xai',
    'nvidia', 'together', 'fireworks', 'cerebras',
    'ollama', 'lmstudio', 'custom'
  ]),
  baseUrl: z.string().trim().min(1).max(2048),
  model: z.string().trim().min(1).max(256),
  fastModel: z.string().trim().max(256).optional(),
  visionModel: z.string().trim().max(256).optional(),
  keepInBackground: z.boolean().optional(),
  contextLength: z.number().int().min(1024).max(131_072),
  temperature: z.number().min(0).max(2),
  maxSteps: z.number().int().min(1).max(16)
})

interface SettingsFile {
  version: 1 | 2 | 3
  provider: Omit<ProviderSettings, 'apiKey'>
  onboardingComplete?: boolean
  /** An older unbound provider credential was removed and must be entered again. */
  credentialReentryRequired?: boolean
  /** Legacy single-key ciphertext, migrated to providerApiKeysEnc on load. */
  apiKeyEnc?: string
  /** Base64 ciphertexts indexed by provider preset and endpoint origin. */
  providerApiKeysEnc?: Record<string, string>
}

interface SettingsStoreState {
  provider: Omit<ProviderSettings, 'apiKey'>
  apiKey: string
  onboardingComplete: boolean
  credentialReentryRequired: boolean
  providerApiKeysEnc: Record<string, string>
  /** Unencrypted keys are session-only when OS encryption is unavailable. */
  sessionApiKeys: Record<string, string>
}

interface BoundProviderKey {
  version: 1
  credentialId: string
  apiKey: string
}

const MAX_STORED_PROVIDER_KEYS = 64
const MAX_ENCRYPTED_PROVIDER_KEY_LENGTH = 32_768

export const DEFAULT_PROVIDER_SETTINGS: Omit<ProviderSettings, 'apiKey'> = {
  preset: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  contextLength: 8192,
  temperature: 0.2,
  maxSteps: 8
}

function isSettingsFile(value: unknown): value is SettingsFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<SettingsFile>
  const encryptedKeys = file.providerApiKeysEnc
  const validEncryptedKeys = encryptedKeys === undefined || (
    typeof encryptedKeys === 'object' && encryptedKeys !== null && !Array.isArray(encryptedKeys) &&
    Object.entries(encryptedKeys).length <= MAX_STORED_PROVIDER_KEYS &&
    Object.entries(encryptedKeys).every(([credentialId, entry]) =>
      credentialId.length <= 4_096 && typeof entry === 'string' && entry.length <= MAX_ENCRYPTED_PROVIDER_KEY_LENGTH
    )
  )
  return (file.version === 1 || file.version === 2 || file.version === 3) && Boolean(file.provider && typeof file.provider === 'object' && !Array.isArray(file.provider)) &&
    (file.onboardingComplete === undefined || typeof file.onboardingComplete === 'boolean') &&
    (file.credentialReentryRequired === undefined || typeof file.credentialReentryRequired === 'boolean') &&
    (file.apiKeyEnc === undefined || typeof file.apiKeyEnc === 'string') &&
    validEncryptedKeys
}

/**
 * Provider configuration, stored outside the audit log. The API key is never
 * returned to the renderer and is only persisted when the OS keychain is
 * available; otherwise it lives in memory for this session.
 */
export class SettingsStore {
  private provider: Omit<ProviderSettings, 'apiKey'> = { ...DEFAULT_PROVIDER_SETTINGS }
  private apiKey = ''
  private onboardingComplete = false
  private credentialReentryRequired = false
  private providerApiKeysEnc: Record<string, string> = {}
  private sessionApiKeys: Record<string, string> = {}
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly codec?: SecretCodec
  ) {}

  async init(): Promise<void> {
    await this.mutate(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      const loaded = await readJsonStore<SettingsFile>(this.file, 'settings', isSettingsFile)

      const next: SettingsStoreState = {
        provider: { ...DEFAULT_PROVIDER_SETTINGS },
        apiKey: '',
        onboardingComplete: loaded?.onboardingComplete === true,
        credentialReentryRequired: loaded?.credentialReentryRequired === true || Boolean(loaded?.apiKeyEnc),
        providerApiKeysEnc: Object.fromEntries(
          Object.entries(loaded?.providerApiKeysEnc ?? {}).filter(([, encrypted]) => encrypted.length > 0)
        ),
        sessionApiKeys: {}
      }
      if (loaded?.provider) {
        const parsed = providerSchema.safeParse(loaded.provider)
        if (parsed.success) {
          const safeBaseUrl = safeProviderEndpointForDisplay(parsed.data.baseUrl)
          const provider = migrateRetiredAnthropicModels(parsed.data)
          if (safeBaseUrl !== parsed.data.baseUrl) {
            console.warn('[settings] removed credentials or query data from the provider URL')
          }
          next.provider = { ...provider, baseUrl: safeBaseUrl }
        } else {
          console.warn('[settings] ignoring invalid settings file')
        }
      }

      const activeKeyId = providerCredentialId(next.provider)
      if (this.codec?.available) {
        for (const [credentialId, encrypted] of Object.entries(next.providerApiKeysEnc)) {
          try {
            const decrypted = await this.codec.decrypt(encrypted)
            const bound = parseBoundProviderKey(decrypted.value)
            if (!bound || bound.credentialId !== credentialId) {
              // Older ciphertext was not bound to the provider identity. An
              // imported settings file could otherwise move it to an attacker URL.
              delete next.providerApiKeysEnc[credentialId]
              next.credentialReentryRequired = true
              console.warn('[settings] discarded a stored provider key without a matching provider binding')
            } else if (credentialId === activeKeyId) {
              next.apiKey = bound.apiKey
            }
          } catch (error) {
            console.warn('[settings] could not decrypt a stored provider key; preserving its ciphertext', error)
          }
        }
      }

      // Persist also refreshes ciphertext when the OS key signals rotation.
      this.apply(await this.persist(next))
    })
  }

  /** Full settings including the secret, for main-process use only. */
  get(): AppSettings {
    return {
      provider: {
        ...this.provider,
        apiKey: this.apiKey || undefined
      }
    }
  }

  /** Renderer-safe view: no secret, just whether one exists. */
  public(): {
    provider: Omit<ProviderSettings, 'apiKey'> & {
      hasApiKey: boolean
      apiKeyStored: boolean
      credentialReentryRequired: boolean
      savedCredentials: Array<{
        preset: ProviderSettings['preset']
        origin: string
        storedSecurely: boolean
      }>
    }
    onboardingComplete: boolean
  } {
    return {
      provider: {
        ...this.provider,
        baseUrl: safeProviderEndpointForDisplay(this.provider.baseUrl),
        hasApiKey: this.hasProviderKey(this.provider),
        apiKeyStored: Boolean(this.providerApiKeysEnc[providerCredentialId(this.provider)]),
        credentialReentryRequired: this.credentialReentryRequired,
        savedCredentials: this.listSavedCredentials()
      },
      onboardingComplete: this.onboardingComplete
    }
  }

  private listSavedCredentials(): Array<{
    preset: ProviderSettings['preset']
    origin: string
    storedSecurely: boolean
  }> {
    const credentials = new Map<string, { preset: ProviderSettings['preset']; origin: string; storedSecurely: boolean }>()
    for (const keyId of Object.keys(this.providerApiKeysEnc)) {
      const credential = parseProviderCredentialId(keyId)
      if (credential) credentials.set(keyId, { ...credential, storedSecurely: true })
    }
    for (const keyId of Object.keys(this.sessionApiKeys)) {
      const credential = parseProviderCredentialId(keyId)
      if (credential && !credentials.has(keyId)) credentials.set(keyId, { ...credential, storedSecurely: false })
    }
    if (this.apiKey) {
      const keyId = providerCredentialId(this.provider)
      const credential = parseProviderCredentialId(keyId)
      if (credential && !credentials.has(keyId)) credentials.set(keyId, { ...credential, storedSecurely: false })
    }
    return [...credentials.values()].sort((a, b) => a.preset.localeCompare(b.preset) || a.origin.localeCompare(b.origin))
  }

  async completeOnboarding(): Promise<void> {
    await this.mutate(async () => {
      this.apply(await this.persist({ ...this.snapshot(), onboardingComplete: true }))
    })
  }

  async update(
    patch: Partial<Omit<ProviderSettings, 'apiKey'>> & { apiKey?: string | null }
  ): Promise<AppSettings> {
    return this.mutate(async () => {
      const { apiKey, ...rest } = patch
      if (apiKey !== undefined && apiKey !== null && (typeof apiKey !== 'string' || apiKey.length > 4_096)) {
        throw new Error('Invalid settings — API key must be 4,096 characters or fewer.')
      }
      const current = this.snapshot()
      const candidate = { ...current.provider, ...stripUndefined(rest) }
      const parsed = providerSchema.safeParse(candidate)

      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'settings'}: ${issue.message}`)
          .join('; ')
        throw new Error(`Invalid settings — ${detail}`)
      }

      try {
        normalizeProviderEndpoint(parsed.data.baseUrl)
      } catch (error) {
        throw new Error(`Invalid settings — baseUrl: ${error instanceof Error ? error.message : String(error)}`)
      }

      const currentKeyId = providerCredentialId(current.provider)
      const nextKeyId = providerCredentialId(parsed.data)
      const next: SettingsStoreState = {
        ...current,
        provider: parsed.data,
        providerApiKeysEnc: { ...current.providerApiKeysEnc },
        sessionApiKeys: { ...current.sessionApiKeys }
      }

      if (currentKeyId !== nextKeyId && current.apiKey && !current.providerApiKeysEnc[currentKeyId]) {
        next.sessionApiKeys[currentKeyId] = current.apiKey
      }

      if (apiKey !== undefined) {
        next.credentialReentryRequired = false
        if (apiKey === null || apiKey.trim() === '') {
          next.apiKey = ''
          delete next.providerApiKeysEnc[nextKeyId]
          delete next.sessionApiKeys[nextKeyId]
        } else {
          next.apiKey = apiKey.trim()
          if (this.codec?.available) delete next.sessionApiKeys[nextKeyId]
          else next.sessionApiKeys[nextKeyId] = next.apiKey
        }
      } else if (currentKeyId !== nextKeyId) {
        const sessionKey = next.sessionApiKeys[nextKeyId]
        const encryptedKey = next.providerApiKeysEnc[nextKeyId]
        next.apiKey = sessionKey ?? ''

        if (!sessionKey && encryptedKey && this.codec?.available) {
          try {
            const decrypted = await this.codec.decrypt(encryptedKey)
            const bound = parseBoundProviderKey(decrypted.value)
            if (bound?.credentialId === nextKeyId) next.apiKey = bound.apiKey
            else {
              delete next.providerApiKeysEnc[nextKeyId]
              next.credentialReentryRequired = true
              console.warn('[settings] discarded a stored provider key without a matching provider binding')
            }
          } catch (error) {
            console.warn('[settings] could not decrypt the selected provider API key; preserving its ciphertext', error)
          }
        }
      }

      this.apply(await this.persist(next))
      return this.get()
    })
  }

  /** Saves one provider's credential without changing the active provider. */
  async saveProviderApiKey(
    provider: Pick<ProviderSettings, 'preset' | 'baseUrl'>,
    apiKey: string
  ): Promise<boolean> {
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0 || apiKey.length > 4_096) {
      throw new Error('Invalid provider API key.')
    }
    const parsedPreset = z.enum([
      'openai', 'anthropic', 'gemini', 'openrouter', 'groq', 'deepseek', 'mistral', 'xai',
      'nvidia', 'together', 'fireworks', 'cerebras', 'ollama', 'lmstudio', 'custom'
    ]).safeParse(provider.preset)
    if (!parsedPreset.success) throw new Error('Invalid provider.')
    const normalizedEndpoint = normalizeProviderEndpoint(provider.baseUrl)
    const credentialProvider = { preset: parsedPreset.data, baseUrl: normalizedEndpoint }
    const keyId = providerCredentialId(credentialProvider)

    return this.mutate(async () => {
      const next = this.snapshot()
      next.credentialReentryRequired = false
      next.apiKey = next.provider.preset === credentialProvider.preset &&
        providerCredentialId(next.provider) === keyId ? apiKey.trim() : next.apiKey
      next.providerApiKeysEnc = { ...next.providerApiKeysEnc }
      next.sessionApiKeys = { ...next.sessionApiKeys }
      if (this.codec?.available) {
        next.providerApiKeysEnc[keyId] = await encryptBoundProviderKey(this.codec, keyId, apiKey.trim())
        delete next.sessionApiKeys[keyId]
      } else {
        next.sessionApiKeys[keyId] = apiKey.trim()
        delete next.providerApiKeysEnc[keyId]
      }
      this.apply(await this.persist(next))
      return Boolean(this.providerApiKeysEnc[keyId])
    })
  }

  /** Removes one provider credential without changing the selected provider. */
  async removeProviderApiKey(
    provider: Pick<ProviderSettings, 'preset' | 'baseUrl'>
  ): Promise<boolean> {
    const parsedPreset = providerSchema.shape.preset.safeParse(provider?.preset)
    if (!parsedPreset.success || typeof provider?.baseUrl !== 'string' || provider.baseUrl.length > 2_048) {
      throw new Error('Invalid provider connection.')
    }
    const keyId = providerCredentialId({
      preset: parsedPreset.data,
      baseUrl: normalizeProviderEndpoint(provider.baseUrl)
    })

    return this.mutate(async () => {
      const next = this.snapshot()
      const existed = Boolean(next.providerApiKeysEnc[keyId] || next.sessionApiKeys[keyId])
      if (!existed) return false

      next.providerApiKeysEnc = { ...next.providerApiKeysEnc }
      next.sessionApiKeys = { ...next.sessionApiKeys }
      delete next.providerApiKeysEnc[keyId]
      delete next.sessionApiKeys[keyId]
      if (providerCredentialId(next.provider) === keyId) next.apiKey = ''

      this.apply(await this.persist(next))
      return true
    })
  }

  private snapshot(): SettingsStoreState {
    return {
      provider: this.provider,
      apiKey: this.apiKey,
      onboardingComplete: this.onboardingComplete,
      credentialReentryRequired: this.credentialReentryRequired,
      providerApiKeysEnc: { ...this.providerApiKeysEnc },
      sessionApiKeys: { ...this.sessionApiKeys }
    }
  }

  private apply(state: SettingsStoreState): void {
    this.provider = state.provider
    this.apiKey = state.apiKey
    this.onboardingComplete = state.onboardingComplete
    this.credentialReentryRequired = state.credentialReentryRequired
    this.providerApiKeysEnc = state.providerApiKeysEnc
    this.sessionApiKeys = state.sessionApiKeys
  }

  private hasProviderKey(provider: Pick<ProviderSettings, 'preset' | 'baseUrl'>): boolean {
    const keyId = providerCredentialId(provider)
    return Boolean(this.apiKey && keyId === providerCredentialId(this.provider)) ||
      Boolean(this.providerApiKeysEnc[keyId]) ||
      Boolean(this.sessionApiKeys[keyId])
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async persist(state: SettingsStoreState): Promise<SettingsStoreState> {
    const providerApiKeysEnc = { ...state.providerApiKeysEnc }
    const sessionApiKeys = { ...state.sessionApiKeys }
    if (state.apiKey && this.codec?.available) {
      const activeKeyId = providerCredentialId(state.provider)
      providerApiKeysEnc[activeKeyId] = await encryptBoundProviderKey(this.codec, activeKeyId, state.apiKey)
      delete sessionApiKeys[activeKeyId]
    }

    const storedKeyIds = new Set([...Object.keys(providerApiKeysEnc), ...Object.keys(sessionApiKeys)])
    if (storedKeyIds.size > MAX_STORED_PROVIDER_KEYS ||
      Object.entries(providerApiKeysEnc).some(([credentialId, encrypted]) =>
        credentialId.length > 4_096 || encrypted.length > MAX_ENCRYPTED_PROVIDER_KEY_LENGTH
      )) {
      throw new Error(`Provider settings can store up to ${MAX_STORED_PROVIDER_KEYS} keys. Remove an unused key before adding another.`)
    }

    const payload: SettingsFile = {
      version: 3,
      provider: state.provider,
      onboardingComplete: state.onboardingComplete,
      ...(state.credentialReentryRequired ? { credentialReentryRequired: true } : {}),
      ...(Object.keys(providerApiKeysEnc).length > 0 ? { providerApiKeysEnc } : {})
    }

    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      await rename(temporary, this.file)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
    return { ...state, providerApiKeysEnc, sessionApiKeys }
  }
}

function parseBoundProviderKey(value: string): BoundProviderKey | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return undefined }
  const result = z.object({ version: z.literal(1), credentialId: z.string().min(1).max(4096), apiKey: z.string().min(1).max(4096) }).safeParse(parsed)
  return result.success ? result.data : undefined
}

async function encryptBoundProviderKey(codec: SecretCodec, credentialId: string, apiKey: string): Promise<string> {
  return codec.encrypt(JSON.stringify({ version: 1, credentialId, apiKey } satisfies BoundProviderKey))
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const result: Partial<T> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      result[key as keyof T] = entry as T[keyof T]
    }
  }
  return result
}

function providerOrigin(input: string): string {
  try {
    return new URL(input).origin
  } catch {
    return ''
  }
}

function providerCredentialId(provider: Pick<ProviderSettings, 'preset' | 'baseUrl'>): string {
  return JSON.stringify([provider.preset, providerOrigin(provider.baseUrl)])
}

function parseProviderCredentialId(value: string): { preset: ProviderSettings['preset']; origin: string } | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return undefined }
  const tuple = z.tuple([
    providerSchema.shape.preset,
    z.string().url()
  ]).safeParse(parsed)
  if (!tuple.success) return undefined
  try {
    const origin = new URL(tuple.data[1]).origin
    return origin === tuple.data[1] ? { preset: tuple.data[0], origin } : undefined
  } catch { return undefined }
}

const RETIRED_ANTHROPIC_MODEL_REPLACEMENTS: Record<string, string> = {
  'claude-3-5-sonnet-latest': 'claude-sonnet-5',
  'claude-3-5-sonnet-20240620': 'claude-sonnet-5',
  'claude-3-7-sonnet-latest': 'claude-sonnet-5',
  'claude-3-7-sonnet-20250219': 'claude-sonnet-5',
  'claude-sonnet-4-20250514': 'claude-sonnet-5',
  'claude-3-5-haiku-latest': 'claude-haiku-4-5-20251001',
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5-20251001',
  'claude-3-haiku-20240307': 'claude-haiku-4-5-20251001',
  'claude-3-opus-latest': 'claude-opus-5',
  'claude-3-opus-20240229': 'claude-opus-5',
  'claude-opus-4-20250514': 'claude-opus-5',
  'claude-opus-4-1-20250805': 'claude-opus-5'
}

function migrateRetiredAnthropicModels(
  provider: z.infer<typeof providerSchema>
): z.infer<typeof providerSchema> {
  if (provider.preset !== 'anthropic') return provider
  const replace = (model: string | undefined): string | undefined => {
    if (!model) return model
    return Object.prototype.hasOwnProperty.call(RETIRED_ANTHROPIC_MODEL_REPLACEMENTS, model)
      ? RETIRED_ANTHROPIC_MODEL_REPLACEMENTS[model]
      : model
  }
  const model = replace(provider.model) ?? provider.model
  const fastModel = replace(provider.fastModel)
  const visionModel = replace(provider.visionModel)
  if (model !== provider.model || fastModel !== provider.fastModel || visionModel !== provider.visionModel) {
    console.info('[settings] replaced retired Anthropic model IDs with current model IDs')
  }
  return { ...provider, model, fastModel, visionModel }
}
