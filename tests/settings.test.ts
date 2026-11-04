import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROVIDER_SETTINGS, SettingsStore, type SecretCodec } from '../src/core/settings'

let dir = ''
let file = ''

const codec: SecretCodec = {
  available: true,
  encrypt: async (value) => Buffer.from(`enc:${value}`, 'utf8').toString('base64'),
  decrypt: async (value) => ({
    value: Buffer.from(value, 'base64').toString('utf8').replace(/^enc:/, '')
  })
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-settings-'))
  file = path.join(dir, 'settings.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('starts from the Ollama defaults', async () => {
    const store = new SettingsStore(file)
    await store.init()

    const settings = store.get()
    expect(settings.provider).toMatchObject(DEFAULT_PROVIDER_SETTINGS)
    expect(settings.provider.apiKey).toBeUndefined()
    expect(store.public().onboardingComplete).toBe(false)
  })

  it('persists completion of first-run onboarding', async () => {
    const store = new SettingsStore(file)
    await store.init()
    await store.completeOnboarding()

    const reloaded = new SettingsStore(file)
    await reloaded.init()
    expect(reloaded.public().onboardingComplete).toBe(true)
  })

  it('persists updates across restarts', async () => {
    const store = new SettingsStore(file)
    await store.init()
    await store.update({
      preset: 'lmstudio',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'qwen2.5-7b-instruct',
      contextLength: 16384,
      temperature: 0.5,
      maxSteps: 4
    })

    const reloaded = new SettingsStore(file)
    await reloaded.init()

    expect(reloaded.get().provider).toMatchObject({
      preset: 'lmstudio',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'qwen2.5-7b-instruct',
      contextLength: 16384,
      temperature: 0.5,
      maxSteps: 4
    })
  })

  it('never exposes the API key in the public view', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await store.update({ apiKey: 'sk-secret' })

    const publicView = store.public()
    expect(publicView.provider.hasApiKey).toBe(true)
    expect(publicView.provider.apiKeyStored).toBe(true)
    expect(JSON.stringify(publicView)).not.toContain('sk-secret')
  })

  it('keeps a key in memory only when no keychain is available', async () => {
    const store = new SettingsStore(file)
    await store.init()
    await store.update({ apiKey: 'session-key' })

    expect(store.get().provider.apiKey).toBe('session-key')
    expect(store.public().provider.hasApiKey).toBe(true)
    expect(store.public().provider.apiKeyStored).toBe(false)

    const raw = await readFile(file, 'utf8')
    expect(raw).not.toContain('session-key')

    const reloaded = new SettingsStore(file)
    await reloaded.init()
    expect(reloaded.public().provider.hasApiKey).toBe(false)
  })

  it('stores an encrypted key and decrypts it on load', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await store.update({ apiKey: 'sk-encrypted' })

    const raw = await readFile(file, 'utf8')
    expect(raw).toContain('apiKeyEnc')
    expect(raw).not.toContain('sk-encrypted')

    const reloaded = new SettingsStore(file, codec)
    await reloaded.init()
    expect(reloaded.get().provider.apiKey).toBe('sk-encrypted')
  })

  it('clears a previously loaded API key when reloading settings without one', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await store.update({ apiKey: 'sk-before-restore' })
    await writeFile(file, JSON.stringify({ version: 1, provider: DEFAULT_PROVIDER_SETTINGS }), 'utf8')

    await store.init()

    expect(store.get().provider.apiKey).toBeUndefined()
    expect(store.public().provider.hasApiKey).toBe(false)
    expect(JSON.parse(await readFile(file, 'utf8')).apiKeyEnc).toBeUndefined()
  })

  it('preserves encrypted key material if OS encryption is temporarily unavailable', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await store.update({ apiKey: 'survives-unavailable-keychain' })

    const unavailable = new SettingsStore(file)
    await unavailable.init()
    expect(unavailable.public().provider.hasApiKey).toBe(true)
    expect(unavailable.public().provider.apiKeyStored).toBe(true)

    const recovered = new SettingsStore(file, codec)
    await recovered.init()
    expect(recovered.get().provider.apiKey).toBe('survives-unavailable-keychain')
  })

  it('clears a stored key', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await store.update({ apiKey: 'sk-secret' })
    await store.update({ apiKey: null })

    expect(store.public().provider.hasApiKey).toBe(false)

    const reloaded = new SettingsStore(file, codec)
    await reloaded.init()
    expect(reloaded.public().provider.hasApiKey).toBe(false)
  })

  it('rejects out-of-range settings', async () => {
    const store = new SettingsStore(file)
    await store.init()

    await expect(store.update({ contextLength: 10 })).rejects.toThrow(/Invalid settings/)
    await expect(store.update({ temperature: 9 })).rejects.toThrow(/Invalid settings/)
    await expect(store.update({ maxSteps: 99 })).rejects.toThrow(/Invalid settings/)
    await expect(store.update({ model: '   ' })).rejects.toThrow(/Invalid settings/)
    await expect(store.update({ baseUrl: '' })).rejects.toThrow(/Invalid settings/)
  })

  it('requires HTTPS for remote model providers and keeps URL credentials out of the UI', async () => {
    const store = new SettingsStore(file)
    await store.init()

    await expect(store.update({ baseUrl: 'http://api.example.com/v1' })).rejects.toThrow(/Remote provider URLs must use HTTPS/)
    await expect(store.update({ baseUrl: 'https://user:secret@api.example.com/v1' })).rejects.toThrow(/cannot contain credentials/)

    await writeFile(file, JSON.stringify({
      version: 1,
      provider: {
        ...DEFAULT_PROVIDER_SETTINGS,
        baseUrl: 'https://user:secret@api.example.com/v1?token=secret'
      }
    }), 'utf8')
    const reloaded = new SettingsStore(file)
    await reloaded.init()

    expect(JSON.stringify(reloaded.public())).not.toContain('secret')
    expect(reloaded.public().provider.baseUrl).toBe('https://api.example.com/v1')
    expect(await readFile(file, 'utf8')).not.toContain('secret')

    await writeFile(file, JSON.stringify({
      version: 1,
      provider: { ...DEFAULT_PROVIDER_SETTINGS, baseUrl: 'not a url?token=secret' }
    }), 'utf8')
    const malformed = new SettingsStore(file)
    await malformed.init()
    expect(JSON.stringify(malformed.public())).not.toContain('secret')
    expect(malformed.public().provider.baseUrl).toBe('')
  })

  it('recovers from a corrupt settings file', async () => {
    await writeFile(file, '{not json', 'utf8')

    const store = new SettingsStore(file)
    await store.init()

    expect(store.get().provider).toMatchObject(DEFAULT_PROVIDER_SETTINGS)
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1 })
  })
})
