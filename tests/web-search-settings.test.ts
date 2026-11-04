import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSearchSettingsStore } from '../src/core/web-search-settings'
import type { SecretCodec } from '../src/core/settings'

let dir = ''
let file = ''

const codec: SecretCodec = {
  available: true,
  encrypt: async (value) => Buffer.from(`encrypted:${value}`, 'utf8').toString('base64'),
  decrypt: async (value) => ({ value: Buffer.from(value, 'base64').toString('utf8').replace(/^encrypted:/, '') })
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-web-search-'))
  file = path.join(dir, 'web-search.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('WebSearchSettingsStore', () => {
  it('encrypts the API key and never returns it in the public view', async () => {
    const store = new WebSearchSettingsStore(file, codec)
    await store.init()
    const publicSettings = await store.updateApiKey('tavily-secret-key')
    const raw = await readFile(file, 'utf8')

    expect(publicSettings).toEqual({ hasApiKey: true, apiKeyStored: true })
    expect(JSON.stringify(publicSettings)).not.toContain('tavily-secret-key')
    expect(raw).toContain('apiKeyEnc')
    expect(raw).not.toContain('tavily-secret-key')

    const reloaded = new WebSearchSettingsStore(file, codec)
    await reloaded.init()
    expect(reloaded.getApiKey()).toBe('tavily-secret-key')
  })

  it('keeps a key in memory only when OS encryption is unavailable', async () => {
    const store = new WebSearchSettingsStore(file)
    await store.init()
    await store.updateApiKey('session-only-secret')
    expect(store.getApiKey()).toBe('session-only-secret')
    expect(store.public()).toEqual({ hasApiKey: true, apiKeyStored: false })
    expect(await readFile(file, 'utf8')).not.toContain('session-only-secret')

    const reloaded = new WebSearchSettingsStore(file)
    await reloaded.init()
    expect(reloaded.getApiKey()).toBeUndefined()
  })

  it('does not apply an API key update when persisting it fails', async () => {
    const store = new WebSearchSettingsStore(file, codec)
    await store.init()
    await rm(file)
    await mkdir(file)

    await expect(store.updateApiKey('tavily-not-saved')).rejects.toBeDefined()

    expect(store.getApiKey()).toBeUndefined()
    expect(store.public()).toEqual({ hasApiKey: false, apiKeyStored: false })
  })

  it('preserves encrypted material while the keychain is temporarily unavailable', async () => {
    const store = new WebSearchSettingsStore(file, codec)
    await store.init()
    await store.updateApiKey('stored-secret-key')

    const unavailable = new WebSearchSettingsStore(file)
    await unavailable.init()
    expect(unavailable.public()).toEqual({ hasApiKey: true, apiKeyStored: true })

    const recovered = new WebSearchSettingsStore(file, codec)
    await recovered.init()
    expect(recovered.getApiKey()).toBe('stored-secret-key')
  })

  it('clears the key and rejects malformed values', async () => {
    const store = new WebSearchSettingsStore(file, codec)
    await store.init()
    await store.updateApiKey('a-valid-test-key')
    await store.updateApiKey(null)
    expect(store.public()).toEqual({ hasApiKey: false, apiKeyStored: false })
    await expect(store.updateApiKey('short')).rejects.toThrow(/valid Tavily API key/)
    await expect(store.updateApiKey('unsafe\r\nkeyvalue')).rejects.toThrow(/valid Tavily API key/)
  })

  it('clears a previously loaded API key when reinitializing from a missing settings file', async () => {
    const store = new WebSearchSettingsStore(file, codec)
    await store.init()
    await store.updateApiKey('tavily-before-restore')
    await rm(file)

    await store.init()

    expect(store.getApiKey()).toBeUndefined()
    expect(store.public()).toEqual({ hasApiKey: false, apiKeyStored: false })
  })
})
