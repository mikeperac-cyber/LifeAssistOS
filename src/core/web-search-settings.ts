import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SecretCodec } from './settings'

interface WebSearchSettingsFile {
  version: 1
  apiKeyEnc?: string
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

  constructor(
    private readonly file: string,
    private readonly codec?: SecretCodec
  ) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    try {
      const loaded = JSON.parse(await readFile(this.file, 'utf8')) as Partial<WebSearchSettingsFile>
      if (loaded.version === 1 && typeof loaded.apiKeyEnc === 'string' && loaded.apiKeyEnc.length > 0) {
        this.storedApiKeyEnc = loaded.apiKeyEnc
        this.apiKeyStored = true
        if (this.codec?.available) {
          try {
            const decrypted = await this.codec.decrypt(loaded.apiKeyEnc)
            this.apiKey = decrypted.value
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
    await this.persist()
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
    if (input === null) {
      this.apiKey = ''
      this.apiKeyStored = false
      this.storedApiKeyEnc = undefined
    } else {
      const apiKey = input.trim()
      if (apiKey.length < 8 || apiKey.length > 512 || /[\u0000-\u001f\u007f]/.test(apiKey)) {
        throw new Error('Enter a valid Tavily API key (8–512 characters), or clear the saved key.')
      }
      this.apiKey = apiKey
      this.apiKeyStored = Boolean(this.codec?.available)
      this.storedApiKeyEnc = undefined
    }
    await this.persist()
    return this.public()
  }

  private async persist(): Promise<void> {
    if (this.apiKey && this.apiKeyStored && this.codec?.available) {
      this.storedApiKeyEnc = await this.codec.encrypt(this.apiKey)
    }
    const payload: WebSearchSettingsFile = {
      version: 1,
      ...(this.storedApiKeyEnc ? { apiKeyEnc: this.storedApiKeyEnc } : {})
    }
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(temporary, this.file)
  }
}
