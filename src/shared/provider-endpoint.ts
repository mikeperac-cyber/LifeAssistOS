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

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isLoopback = host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)
  if (url.protocol === 'http:' && !isLoopback) {
    throw new Error('Remote provider URLs must use HTTPS. HTTP is allowed only for localhost, 127.0.0.1, or [::1].')
  }

  if (!url.pathname || url.pathname === '/') url.pathname = '/v1'
  return url.toString().replace(/\/+$/, '')
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
