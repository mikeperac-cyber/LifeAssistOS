import { describe, expect, it } from 'vitest'
import type { PublicSettings } from '../src/shared/ipc'
import { isProviderReady } from '../src/renderer/src/components/provider-readiness'

const settings = (preset: string, baseUrl: string, hasApiKey: boolean): PublicSettings => ({
  onboardingComplete: true,
  provider: {
    preset: preset as PublicSettings['provider']['preset'],
    baseUrl,
    model: 'test-model',
    contextLength: 8192,
    temperature: 0.2,
    maxSteps: 5,
    hasApiKey,
    apiKeyStored: false,
    credentialReentryRequired: false,
    savedCredentials: []
  }
})

describe('isProviderReady', () => {
  it('requires settings and credentials for hosted providers', () => {
    expect(isProviderReady(null)).toBe(false)
    expect(isProviderReady(settings('openai', 'https://api.openai.com/v1', false))).toBe(false)
    expect(isProviderReady(settings('openai', 'https://api.openai.com/v1', true))).toBe(true)
  })

  it('allows local providers without API keys', () => {
    expect(isProviderReady(settings('ollama', 'http://localhost:11434/v1', false))).toBe(true)
    expect(isProviderReady(settings('lmstudio', 'http://127.0.0.1:1234/v1', false))).toBe(true)
    expect(isProviderReady(settings('openai', 'http://assistant.localhost/v1', false))).toBe(true)
  })

  it('does not treat arbitrary remote endpoints as local', () => {
    expect(isProviderReady(settings('openai', 'https://localhost.attacker.example/v1', false))).toBe(false)
    expect(isProviderReady(settings('openai', 'not a url', false))).toBe(false)
  })
})
