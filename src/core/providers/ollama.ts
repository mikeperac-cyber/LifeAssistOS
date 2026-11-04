import { normalizeBaseUrl } from './openai-compatible'

export interface OllamaInfo {
  version?: string
  models: string[]
  /** Whether the selected model advertises tool support. */
  supportsTools?: boolean
  /** Context window the server actually loaded for the model, if it is resident. */
  loadedContext?: number
  /** Context window the model was trained with, if the server reports it. */
  maxContext?: number
}

/**
 * Ollama's OpenAI-compatible endpoint silently ignores context-length options,
 * so the only trustworthy source is the native API. This inspects the running
 * server without changing anything.
 */
export async function inspectOllama(
  baseUrl: string,
  model: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<OllamaInfo> {
  const root = ollamaNativeBase(baseUrl)
  const fetchImpl = options.fetchImpl ?? fetch
  const info: OllamaInfo = { models: [] }

  const version = await getJson<{ version?: string }>(fetchImpl, `${root}/api/version`, options.signal)
  if (!version) {
    throw new Error('No Ollama server answered at that address.')
  }
  info.version = version.version

  const tags = await getJson<{ models?: Array<{ name?: string; model?: string }> }>(
    fetchImpl,
    `${root}/api/tags`,
    options.signal
  )
  info.models = (tags?.models ?? [])
    .map((entry) => entry.name ?? entry.model ?? '')
    .filter((name) => name.length > 0)
    .sort((a, b) => a.localeCompare(b))

  if (model) {
    const shown = await postJson<{
      template?: string
      capabilities?: string[]
      model_info?: Record<string, unknown>
    }>(fetchImpl, `${root}/api/show`, { model }, options.signal)

    if (shown) {
      if (Array.isArray(shown.capabilities)) {
        info.supportsTools = shown.capabilities.includes('tools')
      } else if (typeof shown.template === 'string') {
        info.supportsTools = /\.Tools\b/.test(shown.template)
      }

      const contextEntry = Object.entries(shown.model_info ?? {}).find(([key]) =>
        key.endsWith('.context_length')
      )
      if (contextEntry && typeof contextEntry[1] === 'number') {
        info.maxContext = contextEntry[1]
      }
    }

    const running = await getJson<{
      models?: Array<{ name?: string; model?: string; context_length?: number }>
    }>(fetchImpl, `${root}/api/ps`, options.signal)

    const resident = running?.models?.find(
      (entry) => entry.name === model || entry.model === model
    )
    if (resident && typeof resident.context_length === 'number') {
      info.loadedContext = resident.context_length
    }
  }

  return info
}

/** Turns http://host:11434/v1 into http://host:11434 for the native API. */
export function ollamaNativeBase(baseUrl: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl))
  url.pathname = url.pathname.replace(/\/v1\/?$/, '')
  return url.toString().replace(/\/+$/, '')
}

async function getJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  signal?: AbortSignal
): Promise<T | null> {
  try {
    const response = await fetchImpl(url, { method: 'GET', signal })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

async function postJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T | null> {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}
