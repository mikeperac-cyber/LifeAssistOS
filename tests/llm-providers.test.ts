import { describe, expect, it } from 'vitest'
import { createAnthropicProvider } from '../src/core/providers/anthropic'
import { createProviderForSettings } from '../src/core/providers/factory'
import type { ProviderSettings } from '../src/shared/types'

describe('retained AI providers', () => {
  it('sends Anthropic requests through the existing provider settings and key', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input)
      capturedInit = init
      return new Response(JSON.stringify({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Draft prepared.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 4 }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const settings: ProviderSettings = {
      preset: 'anthropic',
      baseUrl: 'http://localhost:3000/v1',
      model: 'claude-sonnet-5',
      fastModel: 'claude-haiku-4-5-20251001',
      apiKey: 'test-secret',
      contextLength: 8192,
      temperature: 0.2,
      maxSteps: 8
    }
    const provider = createProviderForSettings(settings, 'fast', { fetchImpl })
    const result = await provider.chat({
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Draft a task.' }
      ]
    })

    expect(result.text).toBe('Draft prepared.')
    expect(capturedUrl).toBe('http://localhost:3000/v1/messages')
    expect((capturedInit?.headers as Record<string, string>)['x-api-key']).toBe('test-secret')
    expect(capturedInit?.headers).toMatchObject({ 'anthropic-version': '2023-06-01' })
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      model: 'claude-haiku-4-5-20251001',
      system: 'Be concise.',
      messages: [{ role: 'user', content: 'Draft a task.' }]
    })
  })

  it('lists provider models using the configured endpoint', async () => {
    const requests: string[] = []
    const provider = createAnthropicProvider({
      baseUrl: 'http://localhost:3000/v1',
      model: 'claude-sonnet-5',
      fetchImpl: async (input) => {
        requests.push(String(input))
        return new Response(JSON.stringify({ data: [{ id: 'claude-haiku-4-5-20251001' }, { id: 'claude-sonnet-5' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
    })

    await expect(provider.listModels()).resolves.toEqual(['claude-haiku-4-5-20251001', 'claude-sonnet-5'])
    expect(requests).toEqual(['http://localhost:3000/v1/models'])
  })
})
