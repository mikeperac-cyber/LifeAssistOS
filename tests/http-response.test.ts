import { describe, expect, it } from 'vitest'
import { readProviderResponseText } from '../src/core/providers/http-response'

describe('readProviderResponseText', () => {
  it('cancels a response body when its declared length exceeds the limit', async () => {
    let canceled = false
    const response = new Response(new ReadableStream<Uint8Array>({
      start() {},
      cancel() { canceled = true }
    }), { headers: { 'content-length': '5' } })

    await expect(readProviderResponseText(response, 4)).rejects.toMatchObject({ code: 'bad_response' })
    expect(canceled).toBe(true)
  })
})
