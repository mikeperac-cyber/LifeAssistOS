import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { SecretCodec } from './settings'

interface WebSearchSettingsFile {
  version: 1
  apiKeyEnc?: string
}

interface WebSearchSettingsState {
  apiKey: string
  storedApiKeyEnc?: string
  apiKeyStored: boolean
}

export interface PublicWebSearchSettings {
  hasApiKey: boolean
  apiKeyStored: boolean
}

/** Stores an optional Tavily key without ever exposing it to the renderer. */
export class WebSearchSettingsStore {
  private apiKey = ''
  private storedApiKeyEnc?: string
  private apiKeyStored = false
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly codec?: SecretCodec
  ) {}

  async init(): Promise<void> {
    await this.mutate(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      const next: WebSearchSettingsState = { apiKey: '', apiKeyStored: false }
      try {
        const loaded = JSON.parse(await readFile(this.file, 'utf8')) as Partial<WebSearchSettingsFile>
        if (loaded.version === 1 && typeof loaded.apiKeyEnc === 'string' && loaded.apiKeyEnc.length > 0) {
          next.storedApiKeyEnc = loaded.apiKeyEnc
          next.apiKeyStored = true
          if (this.codec?.available) {
            try {
              const decrypted = await this.codec.decrypt(loaded.apiKeyEnc)
              next.apiKey = decrypted.value
            } catch (error) {
              console.warn('[web-search] could not decrypt the stored key; preserving its ciphertext', error)
            }
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('[web-search] could not read settings file', error)
        }
      }
      this.apply(await this.persist(next))
    })
  }

  getApiKey(): string | undefined {
    return this.apiKey || undefined
  }

  public(): PublicWebSearchSettings {
    return {
      hasApiKey: this.apiKey.length > 0 || Boolean(this.storedApiKeyEnc),
      apiKeyStored: this.apiKeyStored
    }
  }

  async updateApiKey(input: string | null): Promise<PublicWebSearchSettings> {
    return this.mutate(async () => {
      const next: WebSearchSettingsState = { ...this.snapshot() }
      if (input === null) {
        next.apiKey = ''
        next.apiKeyStored = false
        next.storedApiKeyEnc = undefined
      } else {
        const apiKey = input.trim()
        if (apiKey.length < 8 || apiKey.length > 512 || /[\u0000-\u001f\u007f]/.test(apiKey)) {
          throw new Error('Enter a valid Tavily API key (8–512 characters), or clear the saved key.')
        }
        next.apiKey = apiKey
        next.apiKeyStored = Boolean(this.codec?.available)
        next.storedApiKeyEnc = undefined
      }
      this.apply(await this.persist(next))
      return this.public()
    })
  }

  private snapshot(): WebSearchSettingsState {
    return { apiKey: this.apiKey, apiKeyStored: this.apiKeyStored, storedApiKeyEnc: this.storedApiKeyEnc }
  }

  private apply(state: WebSearchSettingsState): void {
    this.apiKey = state.apiKey
    this.apiKeyStored = state.apiKeyStored
    this.storedApiKeyEnc = state.storedApiKeyEnc
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async persist(state: WebSearchSettingsState): Promise<WebSearchSettingsState> {
    const storedApiKeyEnc = state.apiKey && state.apiKeyStored && this.codec?.available
      ? await this.codec.encrypt(state.apiKey)
      : state.storedApiKeyEnc
    const payload: WebSearchSettingsFile = {
      version: 1,
      ...(storedApiKeyEnc ? { apiKeyEnc: storedApiKeyEnc } : {})
    }
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      await rename(temporary, this.file)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
    return { ...state, storedApiKeyEnc }
  }
}
