import { ProviderError } from './types'

export const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_PROVIDER_ERROR_BYTES = 32 * 1024

export async function readProviderResponseText(
  response: Response,
  maxBytes = MAX_PROVIDER_RESPONSE_BYTES
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new ProviderError('The provider response was too large.', { code: 'bad_response' })
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new ProviderError('The provider response was too large.', { code: 'bad_response' })
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(body)
}

export async function readProviderErrorText(response: Response): Promise<string> {
  try { return await readProviderResponseText(response, MAX_PROVIDER_ERROR_BYTES) }
  catch { return '' }
}
