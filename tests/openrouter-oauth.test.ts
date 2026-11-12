import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenRouterOAuth } from '../src/core/openrouter-oauth'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenRouter OAuth response handling', () => {
  it('cancels an oversized declared token-exchange response', async () => {
    const realFetch = globalThis.fetch.bind(globalThis)
    let bodyCancelled = false
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== 'https://openrouter.ai/api/v1/auth/keys') return realFetch(input, init)
      return new Response(new ReadableStream<Uint8Array>({
        start() {},
        cancel() { bodyCancelled = true }
      }), { headers: { 'content-length': '16385' } })
    })

    const oauth = new OpenRouterOAuth()
    const result = await oauth.connect(async (authorizationUrl) => {
      const authorization = new URL(authorizationUrl)
      const callback = new URL(authorization.searchParams.get('callback_url')!)
      callback.searchParams.set('code', 'test-code')
      callback.searchParams.set('state', authorization.searchParams.get('state')!)
      const response = await realFetch(callback)
      await response.arrayBuffer()
    }, async () => {
      throw new Error('Unexpected credential save.')
    })

    expect(result).toMatchObject({ ok: false, error: 'OpenRouter returned an oversized sign-in response.' })
    expect(bodyCancelled).toBe(true)
  })
})
