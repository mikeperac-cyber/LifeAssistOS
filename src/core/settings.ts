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
  version: 1 | 2
  provider: Omit<ProviderSettings, 'apiKey'>
  onboardingComplete?: boolean
  /** Legacy single-key ciphertext, migrated to providerApiKeysEnc on load. */
  apiKeyEnc?: string
  /** Base64 ciphertexts indexed by provider preset and endpoint origin. */
  providerApiKeysEnc?: Record<string, string>
}

interface SettingsStoreState {
  provider: Omit<ProviderSettings, 'apiKey'>
  apiKey: string
  onboardingComplete: boolean
  providerApiKeysEnc: Record<string, string>
  /** Unencrypted keys are session-only when OS encryption is unavailable. */
  sessionApiKeys: Record<string, string>
}

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
    Object.values(encryptedKeys).every((entry) => typeof entry === 'string')
  )
  return (file.version === 1 || file.version === 2) && Boolean(file.provider && typeof file.provider === 'object' && !Array.isArray(file.provider)) &&
    (file.onboardingComplete === undefined || typeof file.onboardingComplete === 'boolean') &&
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
      if (loaded?.apiKeyEnc && !next.providerApiKeysEnc[activeKeyId]) {
        next.providerApiKeysEnc[activeKeyId] = loaded.apiKeyEnc
      }

      const activeKeyEnc = next.providerApiKeysEnc[activeKeyId]
      if (activeKeyEnc) {
        if (this.codec?.available) {
          try {
            const decrypted = await this.codec.decrypt(activeKeyEnc)
            next.apiKey = decrypted.value
          } catch (error) {
            console.warn('[settings] could not decrypt the stored API key; preserving its ciphertext', error)
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
    }
    onboardingComplete: boolean
  } {
    return {
      provider: {
        ...this.provider,
        baseUrl: safeProviderEndpointForDisplay(this.provider.baseUrl),
        hasApiKey: this.hasProviderKey(this.provider),
        apiKeyStored: Boolean(this.providerApiKeysEnc[providerCredentialId(this.provider)])
      },
      onboardingComplete: this.onboardingComplete
    }
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
            next.apiKey = (await this.codec.decrypt(encryptedKey)).value
          } catch (error) {
            console.warn('[settings] could not decrypt the selected provider API key; preserving its ciphertext', error)
          }
        }
      }

      this.apply(await this.persist(next))
      return this.get()
    })
  }

  private snapshot(): SettingsStoreState {
    return {
      provider: this.provider,
      apiKey: this.apiKey,
      onboardingComplete: this.onboardingComplete,
      providerApiKeysEnc: { ...this.providerApiKeysEnc },
      sessionApiKeys: { ...this.sessionApiKeys }
    }
  }

  private apply(state: SettingsStoreState): void {
    this.provider = state.provider
    this.apiKey = state.apiKey
    this.onboardingComplete = state.onboardingComplete
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
      providerApiKeysEnc[activeKeyId] = await this.codec.encrypt(state.apiKey)
      delete sessionApiKeys[activeKeyId]
    }

    const payload: SettingsFile = {
      version: 2,
      provider: state.provider,
      onboardingComplete: state.onboardingComplete,
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
