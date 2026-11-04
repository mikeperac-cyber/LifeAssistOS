import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { AppSettings, ProviderSettings } from '../shared/types'
import { normalizeProviderEndpoint, safeProviderEndpointForDisplay } from '../shared/provider-endpoint'

/** Encrypts the API key at rest. In Electron this is backed by safeStorage. */
export interface SecretCodec {
  available: boolean
  encrypt(value: string): Promise<string>
  decrypt(value: string): Promise<{ value: string; shouldReEncrypt?: boolean }>
}

const providerSchema = z.object({
  preset: z.enum(['ollama', 'lmstudio', 'openai', 'anthropic', 'gemini', 'custom']),
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
  version: 1
  provider: Omit<ProviderSettings, 'apiKey'>
  onboardingComplete?: boolean
  /** Base64 ciphertext from safeStorage, when available. */
  apiKeyEnc?: string
}

export const DEFAULT_PROVIDER_SETTINGS: Omit<ProviderSettings, 'apiKey'> = {
  preset: 'ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen2.5:3b',
  contextLength: 8192,
  temperature: 0.2,
  maxSteps: 8
}

/**
 * Provider configuration, stored outside the audit log. The API key is never
 * returned to the renderer and is only persisted when the OS keychain is
 * available; otherwise it lives in memory for this session.
 */
export class SettingsStore {
  private provider: Omit<ProviderSettings, 'apiKey'> = { ...DEFAULT_PROVIDER_SETTINGS }
  private apiKey = ''
  private apiKeyStored = false
  private onboardingComplete = false
  private storedApiKeyEnc?: string

  constructor(
    private readonly file: string,
    private readonly codec?: SecretCodec
  ) {}

  async init(): Promise<void> {
    this.provider = { ...DEFAULT_PROVIDER_SETTINGS }
    this.apiKey = ''
    this.apiKeyStored = false
    this.onboardingComplete = false
    this.storedApiKeyEnc = undefined
    await mkdir(path.dirname(this.file), { recursive: true })

    let loaded: SettingsFile | null = null
    try {
      loaded = JSON.parse(await readFile(this.file, 'utf8')) as SettingsFile
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[settings] could not read settings file, using defaults', error)
      }
    }

    if (loaded?.provider) {
      const parsed = providerSchema.safeParse(loaded.provider)
      if (parsed.success) {
        const safeBaseUrl = safeProviderEndpointForDisplay(parsed.data.baseUrl)
        if (safeBaseUrl !== parsed.data.baseUrl) {
          console.warn('[settings] removed credentials or query data from the provider URL')
        }
        this.provider = { ...parsed.data, baseUrl: safeBaseUrl }
      } else {
        console.warn('[settings] ignoring invalid settings file')
      }
    }

    this.onboardingComplete = loaded?.onboardingComplete === true

    if (loaded?.apiKeyEnc) {
      this.storedApiKeyEnc = loaded.apiKeyEnc
      this.apiKeyStored = true
      if (this.codec?.available) {
        try {
          const decrypted = await this.codec.decrypt(loaded.apiKeyEnc)
          this.apiKey = decrypted.value
        } catch (error) {
          console.warn('[settings] could not decrypt the stored API key; preserving its ciphertext', error)
        }
      }
    }

    // Persist also refreshes ciphertext when the OS key signals rotation.
    await this.persist()
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
        hasApiKey: this.apiKey.length > 0 || Boolean(this.storedApiKeyEnc),
        apiKeyStored: this.apiKeyStored
      },
      onboardingComplete: this.onboardingComplete
    }
  }

  async completeOnboarding(): Promise<void> {
    this.onboardingComplete = true
    await this.persist()
  }

  async update(
    patch: Partial<Omit<ProviderSettings, 'apiKey'>> & { apiKey?: string | null }
  ): Promise<AppSettings> {
    const { apiKey, ...rest } = patch
    const candidate = { ...this.provider, ...stripUndefined(rest) }
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

    this.provider = parsed.data

    if (apiKey !== undefined) {
      if (apiKey === null || apiKey.trim() === '') {
        this.apiKey = ''
        this.apiKeyStored = false
        this.storedApiKeyEnc = undefined
      } else {
        this.apiKey = apiKey.trim()
        this.apiKeyStored = Boolean(this.codec?.available)
        this.storedApiKeyEnc = undefined
      }
    }

    await this.persist()
    return this.get()
  }

  private async persist(): Promise<void> {
    const payload: SettingsFile = {
      version: 1,
      provider: this.provider,
      onboardingComplete: this.onboardingComplete
    }

    if (this.apiKey && this.apiKeyStored && this.codec?.available) {
      this.storedApiKeyEnc = await this.codec.encrypt(this.apiKey)
    }
    if (this.storedApiKeyEnc) payload.apiKeyEnc = this.storedApiKeyEnc

    const temp = `${this.file}.tmp`
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(temp, this.file)
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
