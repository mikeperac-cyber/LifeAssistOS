import { describe, expect, it } from 'vitest'
import { isLoopbackProviderEndpoint, normalizeProviderEndpoint, providerRequiresApiKey } from '../src/shared/provider-endpoint'

describe('provider endpoint locality', () => {
  it.each([
    'http://localhost:11434/v1',
    'http://api.localhost:11434/v1',
    'http://127.0.0.1:1234/v1',
    'http://127.22.45.9:1234/v1',
    'http://[::1]:8080/v1'
  ])('recognizes %s as loopback', (endpoint) => {
    expect(isLoopbackProviderEndpoint(endpoint)).toBe(true)
  })

  it('does not label an HTTPS remote provider as local', () => {
    expect(isLoopbackProviderEndpoint('https://api.example.com/v1')).toBe(false)
  })

  it('uses one consistent API-key rule for all call paths', () => {
    expect(providerRequiresApiKey('custom', 'http://api.localhost:8080/v1')).toBe(false)
    expect(providerRequiresApiKey('custom', 'http://127.0.0.1:8080/v1')).toBe(false)
    expect(providerRequiresApiKey('custom', 'https://api.example.com/v1')).toBe(true)
    expect(providerRequiresApiKey('ollama', 'https://host.example/v1')).toBe(false)
    expect(providerRequiresApiKey('openai', 'malformed')).toBe(true)
  })

  it('rejects invalid 127 dotted octets as loopback', () => {
    expect(isLoopbackProviderEndpoint('http://127.999.0.1/v1')).toBe(false)
    expect(() => normalizeProviderEndpoint('http://127.999.0.1/v1')).toThrow('is not a valid URL')
  })

  it('uses the same loopback rule for cleartext endpoint validation', () => {
    expect(() => normalizeProviderEndpoint('http://127.0.0.1:11434/v1')).not.toThrow()
    expect(() => normalizeProviderEndpoint('http://api.example.com/v1')).toThrow('Remote provider URLs must use HTTPS')
  })
})
