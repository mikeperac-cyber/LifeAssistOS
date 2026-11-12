import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  it('starts from the hosted provider defaults', async () => {
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

  it('rejects a provider key that would exceed the persisted credential-map limit', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    for (let index = 0; index < 64; index += 1) {
      await store.saveProviderApiKey({ preset: 'custom', baseUrl: `https://provider-${index}.example/v1` }, 'test-key')
    }

    await expect(store.saveProviderApiKey({ preset: 'custom', baseUrl: 'https://provider-64.example/v1' }, 'test-key'))
      .rejects.toThrow(/up to 64 keys/i)

    const reloaded = new SettingsStore(file, codec)
    await reloaded.init()
    expect(reloaded.public().provider.hasApiKey).toBe(false)
    expect(reloaded.get().provider.preset).toBe(DEFAULT_PROVIDER_SETTINGS.preset)
  })

  it('migrates retired Anthropic model IDs on load and persists the replacements', async () => {
    await writeFile(file, JSON.stringify({
      version: 1,
      provider: {
        ...DEFAULT_PROVIDER_SETTINGS,
        preset: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-3-5-sonnet-latest',
        fastModel: 'claude-3-5-haiku-latest',
        visionModel: 'claude-3-7-sonnet-latest'
      }
    }), 'utf8')

    const store = new SettingsStore(file)
    await store.init()

    expect(store.get().provider).toMatchObject({
      preset: 'anthropic',
      model: 'claude-sonnet-5',
      fastModel: 'claude-haiku-4-5-20251001',
      visionModel: 'claude-sonnet-5'
    })
    const persisted = JSON.parse(await readFile(file, 'utf8')) as { provider: Record<string, unknown> }
    expect(persisted.provider).toMatchObject({
      model: 'claude-sonnet-5',
      fastModel: 'claude-haiku-4-5-20251001',
      visionModel: 'claude-sonnet-5'
    })
  })

  it('test_public_settings_never_include_api_key', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await store.update({ apiKey: 'sk-secret' })

    const publicView = store.public()
    expect(publicView.provider.hasApiKey).toBe(true)
    expect(publicView.provider.apiKeyStored).toBe(true)
    expect(publicView.provider).not.toHaveProperty('apiKey')
    expect(JSON.stringify(publicView)).not.toContain('sk-secret')
  })

  it('lists saved provider endpoints without exposing their API keys', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await store.update({ apiKey: 'openai-secret' })
    await store.update({
      preset: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-5',
      apiKey: 'anthropic-secret'
    })

    const publicView = store.public()
    expect(publicView.provider.savedCredentials).toEqual([
      { preset: 'anthropic', origin: 'https://api.anthropic.com', storedSecurely: true },
      { preset: 'openai', origin: 'https://api.openai.com', storedSecurely: true }
    ])
    expect(JSON.stringify(publicView)).not.toContain('openai-secret')
    expect(JSON.stringify(publicView)).not.toContain('anthropic-secret')
  })

  it('removes an inactive provider key without changing the active provider', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await store.update({ apiKey: 'openai-secret' })
    await store.update({
      preset: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-5',
      apiKey: 'anthropic-secret'
    })

    await expect(store.removeProviderApiKey({ preset: 'openai', baseUrl: 'https://api.openai.com/v1' })).resolves.toBe(true)
    expect(store.get().provider).toMatchObject({ preset: 'anthropic', apiKey: 'anthropic-secret' })
    expect(store.public().provider.savedCredentials).toEqual([
      { preset: 'anthropic', origin: 'https://api.anthropic.com', storedSecurely: true }
    ])

    const reloaded = new SettingsStore(file, codec)
    await reloaded.init()
    expect(reloaded.public().provider.savedCredentials).toHaveLength(1)
    expect(reloaded.public().provider.savedCredentials[0]?.preset).toBe('anthropic')
  })

  it('removes the active provider key from memory and durable storage', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await store.update({ apiKey: 'openai-secret' })

    await expect(store.removeProviderApiKey({ preset: 'openai', baseUrl: 'https://api.openai.com/v1' })).resolves.toBe(true)
    expect(store.get().provider.apiKey).toBeUndefined()
    expect(store.public().provider.hasApiKey).toBe(false)

    const reloaded = new SettingsStore(file, codec)
    await reloaded.init()
    expect(reloaded.public().provider.savedCredentials).toEqual([])
  })

  it('removes session-only keys and rejects malformed connection identities', async () => {
    const store = new SettingsStore(file)
    await store.init()
    await store.update({ apiKey: 'session-key' })

    await expect(store.removeProviderApiKey({ preset: 'openai', baseUrl: 'https://api.openai.com/v1' })).resolves.toBe(true)
    expect(store.public().provider.hasApiKey).toBe(false)
    await expect(store.removeProviderApiKey({ preset: 'invalid' as never, baseUrl: 'https://api.openai.com/v1' })).rejects.toThrow(/Invalid provider connection/)
    await expect(store.removeProviderApiKey({ preset: 'openai', baseUrl: 'http://remote.example/v1' })).rejects.toThrow(/Remote provider URLs must use HTTPS/)
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

  it('test_existing_encrypted_provider_key_survives_settings_reopen', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await store.update({
      preset: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-5',
      apiKey: 'sk-encrypted'
    })

    const raw = await readFile(file, 'utf8')
    const persisted = JSON.parse(raw) as { version: number; providerApiKeysEnc?: Record<string, string> }
    expect(persisted.version).toBe(3)
    expect(Object.values(persisted.providerApiKeysEnc ?? {})).toHaveLength(1)
    expect(raw).not.toContain('sk-encrypted')

    const reloaded = new SettingsStore(file, codec)
    await reloaded.init()
    expect(reloaded.get().provider).toMatchObject({ preset: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk-encrypted' })
    expect(reloaded.public().provider).toMatchObject({ preset: 'anthropic', hasApiKey: true, apiKeyStored: true })
  })

  it('does not send an encrypted key to a provider endpoint changed in a restored settings file', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await store.update({ apiKey: 'sk-bound-secret' })

    const persisted = JSON.parse(await readFile(file, 'utf8')) as {
      provider: Record<string, unknown>
      providerApiKeysEnc: Record<string, string>
    }
    const ciphertext = Object.values(persisted.providerApiKeysEnc)[0]
    persisted.provider.baseUrl = 'https://attacker.example/v1'
    persisted.providerApiKeysEnc = { [JSON.stringify(['openai', 'https://attacker.example'])]: ciphertext! }
    await writeFile(file, JSON.stringify(persisted), 'utf8')

    const restored = new SettingsStore(file, codec)
    await restored.init()

    expect(restored.get().provider.apiKey).toBeUndefined()
    expect(restored.public().provider).toMatchObject({ hasApiKey: false, credentialReentryRequired: true })

    const reloaded = new SettingsStore(file, codec)
    await reloaded.init()
    expect(reloaded.public().provider.credentialReentryRequired).toBe(true)

    await reloaded.update({ apiKey: 'reentered-provider-key' })
    expect(reloaded.public().provider.credentialReentryRequired).toBe(false)
  })

  it('does not reuse legacy unbound encrypted keys from imported settings', async () => {
    await writeFile(file, JSON.stringify({
      version: 2,
      provider: DEFAULT_PROVIDER_SETTINGS,
      providerApiKeysEnc: { [JSON.stringify(['openai', 'https://api.openai.com'])]: await codec.encrypt('legacy-secret') }
    }), 'utf8')

    const restored = new SettingsStore(file, codec)
    await restored.init()

    expect(restored.get().provider.apiKey).toBeUndefined()
    expect(restored.public().provider).toMatchObject({ hasApiKey: false, credentialReentryRequired: true })
  })

  it('does not migrate a legacy key after an imported provider URL changes', async () => {
    await writeFile(file, JSON.stringify({
      version: 1,
      provider: { ...DEFAULT_PROVIDER_SETTINGS, baseUrl: 'https://attacker.example/v1' },
      apiKeyEnc: await codec.encrypt('legacy-secret')
    }), 'utf8')

    const restored = new SettingsStore(file, codec)
    await restored.init()

    expect(restored.get().provider.apiKey).toBeUndefined()
    expect(restored.public().provider.hasApiKey).toBe(false)
  })

  it('clears the previous provider key when the active preset changes', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await store.update({ apiKey: 'openai-secret' })

    await store.update({ preset: 'together', baseUrl: 'https://api.together.ai/v1', model: 'Qwen/Qwen3.5-9B' })

    expect(store.get().provider.apiKey).toBeUndefined()
    expect(store.public().provider).toMatchObject({ hasApiKey: false, apiKeyStored: false, preset: 'together' })
    const persisted = JSON.parse(await readFile(file, 'utf8')) as { apiKeyEnc?: string }
    expect(persisted.apiKeyEnc).toBeUndefined()
  })

  it('clears an API key when the provider endpoint host changes', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await store.update({ apiKey: 'openai-secret' })

    await store.update({ baseUrl: 'https://proxy.example/v1' })

    expect(store.get().provider.apiKey).toBeUndefined()
    expect(store.public().provider.hasApiKey).toBe(false)
  })

  it('does not apply an API key update when persisting it fails', async () => {
    const store = new SettingsStore(file, codec)
    await store.init()
    await rm(file)
    await mkdir(file)

    await expect(store.update({ apiKey: 'sk-not-saved' })).rejects.toBeDefined()

    expect(store.get().provider.apiKey).toBeUndefined()
    expect(store.public().provider).toMatchObject({ hasApiKey: false, apiKeyStored: false })
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

  it('rejects an oversized encrypted-provider-key map before decrypting it', async () => {
    await writeFile(file, JSON.stringify({
      version: 3,
      provider: DEFAULT_PROVIDER_SETTINGS,
      providerApiKeysEnc: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key-${index}`, 'encrypted']))
    }), 'utf8')

    const store = new SettingsStore(file, codec)
    await store.init()

    expect(store.public().provider).toMatchObject({ preset: 'openai', hasApiKey: false })
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
    const raw = '{not json'
    await writeFile(file, raw, 'utf8')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const store = new SettingsStore(file)
      await store.init()

      const backupName = (await readdir(dir)).find((name) => /^settings\.corrupt-.+\.json$/.test(name))
      expect(backupName).toBeDefined()
      expect(await readFile(path.join(dir, backupName as string), 'utf8')).toBe(raw)
      expect(store.get().provider).toMatchObject(DEFAULT_PROVIDER_SETTINGS)
      expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 3 })
    } finally {
      warn.mockRestore()
    }
  })
})
