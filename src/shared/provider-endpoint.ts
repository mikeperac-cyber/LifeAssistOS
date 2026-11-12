import type { ProviderSettings } from './types'

/** Validates transport and removes a trailing slash for an OpenAI-compatible endpoint. */
export function normalizeProviderEndpoint(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('Enter a provider base URL in Settings.')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(`"${input}" is not a valid URL.`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The provider URL must start with http:// or https://.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Provider URLs cannot contain credentials, query parameters, or fragments. Use the API key field for credentials.')
  }

  const isLoopback = isLoopbackHost(url.hostname)
  if (url.protocol === 'http:' && !isLoopback) {
    throw new Error('Remote provider URLs must use HTTPS. HTTP is allowed only for localhost, 127.0.0.1, or [::1].')
  }

  if (!url.pathname || url.pathname === '/') url.pathname = '/v1'
  return url.toString().replace(/\/+$/, '')
}

export function isLoopbackProviderEndpoint(input: string): boolean {
  try { return isLoopbackHost(new URL(input.trim()).hostname) }
  catch { return false }
}

/** One shared credential policy for settings, chat, task AI, and the renderer. */
export function providerRequiresApiKey(preset: ProviderSettings['preset'], endpoint: string): boolean {
  if (preset === 'ollama' || preset === 'lmstudio') return false
  return !isLoopbackProviderEndpoint(endpoint)
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true
  const octets = host.split('.')
  return octets.length === 4 && octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255) && Number(octets[0]) === 127
}

/** Keeps secrets out of renderer-facing settings when older files contain unsafe URLs. */
export function safeProviderEndpointForDisplay(input: string): string {
  try {
    const url = new URL(input)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}
