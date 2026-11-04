import {
  ProviderError,
  type ChatRequest,
  type ChatResponse,
  type ChatUsage,
  type Provider,
  type ProviderToolCall
} from './types'
import { normalizeProviderEndpoint } from '../../shared/provider-endpoint'

export interface OpenAICompatibleConfig {
  baseUrl: string
  model: string
  apiKey?: string
  temperature?: number
  /** Retries for 429/5xx/network failures before any output was streamed. */
  maxRetries?: number
  /** Whole-request deadline. Local models can be slow on first load. */
  timeoutMs?: number
  /** Ollama's OpenAI-compatible image input currently uses a data URL string. */
  imageUrlFormat?: 'nested' | 'string'
  fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_MAX_RETRIES = 2

/**
 * One adapter for every OpenAI-compatible server: Ollama, LM Studio, OpenAI,
 * and anything else that speaks /v1/chat/completions. Chat Completions is the
 * common denominator; the Responses API is not implemented by local servers.
 */
export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): Provider {
  return new OpenAICompatibleProvider(config)
}

class OpenAICompatibleProvider implements Provider {
  readonly name = 'openai-compatible'
  private readonly baseUrl: string
  private readonly model: string
  private readonly apiKey?: string
  private readonly temperature: number
  private readonly maxRetries: number
  private readonly timeoutMs: number
  private readonly imageUrlFormat: 'nested' | 'string'
  private readonly fetchImpl: typeof fetch

  constructor(config: OpenAICompatibleConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl)
    this.model = config.model.trim()
    this.apiKey = config.apiKey?.trim() || undefined
    this.temperature = config.temperature ?? 0.2
    this.maxRetries = Math.max(0, config.maxRetries ?? DEFAULT_MAX_RETRIES)
    this.timeoutMs = Math.max(1_000, config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    this.imageUrlFormat = config.imageUrlFormat ?? 'nested'
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const attempts = this.maxRetries + 1
    let lastError: ProviderError | null = null

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let committed = false
      const markCommitted = (): void => {
        committed = true
      }

      try {
        return await this.attempt(request, markCommitted)
      } catch (error) {
        const providerError = this.toProviderError(error, request.signal)
        lastError = providerError

        const canRetry =
          providerError.retryable &&
          !committed &&
          providerError.code !== 'aborted' &&
          attempt < attempts - 1

        if (!canRetry) throw providerError
        await sleep(400 * 2 ** attempt, request.signal)
      }
    }

    throw lastError ?? new ProviderError('The provider did not respond.', { code: 'network' })
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/models`,
      { method: 'GET', headers: this.headers() },
      signal,
      15_000
    )

    if (!response.ok) {
      throw await this.httpError(response)
    }

    const body = (await response.json().catch(() => null)) as
      | { data?: Array<{ id?: unknown }> }
      | null

    if (!body || !Array.isArray(body.data)) {
      throw new ProviderError('The provider did not return a model list.', {
        code: 'bad_response'
      })
    }

    return body.data
      .map((entry) => (typeof entry?.id === 'string' ? entry.id : ''))
      .filter((id) => id.length > 0)
      .sort((a, b) => a.localeCompare(b))
  }

  private async attempt(
    request: ChatRequest,
    markCommitted: () => void
  ): Promise<ChatResponse> {
    const controller = new AbortController()
    let timedOut = false
    const onAbort = (): void => controller.abort()

    if (request.signal) {
      if (request.signal.aborted) controller.abort()
      else request.signal.addEventListener('abort', onAbort, { once: true })
    }

    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeoutMs)

    const body: Record<string, unknown> = {
      model: this.model,
      messages: serializeProviderMessages(request.messages, this.imageUrlFormat),
      stream: true,
      temperature: request.temperature ?? this.temperature
    }

    if (request.maxTokens) body.max_tokens = request.maxTokens
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools
      body.tool_choice = 'auto'
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers({ Accept: 'text/event-stream' }),
        body: JSON.stringify(body),
        signal: controller.signal
      })

      if (!response.ok) {
        throw await this.httpError(response)
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        return await this.readBuffered(response, request, markCommitted)
      }

      // Keep the timeout and caller abort linked until the entire stream has
      // been consumed; fetch resolves as soon as response headers arrive.
      return await this.readStream(response, request, markCommitted)
    } catch (error) {
      if (request.signal?.aborted) {
        throw new ProviderError('Stopped.', { code: 'aborted', cause: error })
      }
      if (timedOut) {
        throw new ProviderError('The provider timed out.', { code: 'timeout', cause: error })
      }
      throw error
    } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', onAbort)
    }
  }

  private async readBuffered(
    response: Response,
    request: ChatRequest,
    markCommitted: () => void
  ): Promise<ChatResponse> {
    const body = (await response.json().catch(() => null)) as
      | {
          choices?: Array<{
            finish_reason?: string | null
            message?: {
              content?: unknown
              tool_calls?: Array<{
                id?: string
                function?: { name?: string; arguments?: string }
              }>
            }
          }>
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
      | null

    const choice = body?.choices?.[0]
    if (!choice) {
      throw new ProviderError('The provider returned no choices.', { code: 'bad_response' })
    }

    const text = typeof choice.message?.content === 'string' ? choice.message.content : ''
    if (text) {
      markCommitted()
      request.onDelta?.(text)
    }

    const toolCalls = normalizeToolCalls(
      (choice.message?.tool_calls ?? []).map((call, index) => ({
        id: call.id ?? `call_${index}`,
        type: 'function' as const,
        function: {
          name: call.function?.name ?? '',
          arguments: call.function?.arguments ?? ''
        }
      }))
    )

    if (toolCalls.length > 0) markCommitted()

    return {
      text,
      toolCalls,
      finishReason: choice.finish_reason ?? null,
      usage: toUsage(body?.usage)
    }
  }

  private async readStream(
    response: Response,
    request: ChatRequest,
    markCommitted: () => void
  ): Promise<ChatResponse> {
    const reader = response.body?.getReader()
    if (!reader) {
      throw new ProviderError('The provider returned an empty response body.', {
        code: 'bad_response'
      })
    }

    const decoder = new TextDecoder()
    const calls = new Map<number, ProviderToolCall>()
    let buffer = ''
    let text = ''
    let finishReason: string | null = null
    let sawDoneMarker = false
    let usage: ChatUsage | undefined

    const handlePayload = (payload: string): void => {
      if (!payload) return
      if (payload === '[DONE]') {
        sawDoneMarker = true
        return
      }

      let chunk: unknown
      try {
        chunk = JSON.parse(payload)
      } catch {
        // Keep-alive comments and partial frames are not errors.
        return
      }

      const parsed = chunk as {
        choices?: Array<{
          finish_reason?: string | null
          delta?: {
            content?: unknown
            tool_calls?: Array<{
              index?: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
        }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }

      if (parsed.usage) usage = toUsage(parsed.usage)

      const choice = parsed.choices?.[0]
      if (!choice) return
      if (choice.finish_reason) finishReason = choice.finish_reason

      const delta = choice.delta
      if (typeof delta?.content === 'string' && delta.content.length > 0) {
        text += delta.content
        markCommitted()
        request.onDelta?.(delta.content)
      }

      for (const fragment of delta?.tool_calls ?? []) {
        const index = typeof fragment.index === 'number' ? fragment.index : 0
        const entry =
          calls.get(index) ??
          ({ id: '', type: 'function', function: { name: '', arguments: '' } } as ProviderToolCall)

        if (fragment.id) entry.id = fragment.id
        if (fragment.function?.name) entry.function.name += fragment.function.name
        if (fragment.function?.arguments) entry.function.arguments += fragment.function.arguments

        calls.set(index, entry)
        markCommitted()
      }
    }

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        handlePayload(line.slice(5).trim())
      }
    }

    buffer += decoder.decode()
    for (const rawLine of buffer.split('\n')) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      handlePayload(line.slice(5).trim())
    }

    if (!sawDoneMarker && finishReason === null) {
      throw new ProviderError(
        'The provider stream ended before completion. Any text already shown may be incomplete.',
        { code: 'network', retryable: true }
      )
    }

    const ordered = normalizeToolCalls(
      [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
    )

    return { text, toolCalls: ordered, finishReason, usage }
  }

  private async httpError(response: Response): Promise<ProviderError> {
    const body = await response.text().catch(() => '')
    const message = extractErrorMessage(body) || `HTTP ${response.status}`
    const lower = message.toLowerCase()

    if (lower.includes('does not support tools') || lower.includes('does not support tool')) {
      return new ProviderError(message, {
        code: 'tools_unsupported',
        status: response.status
      })
    }

    if (response.status === 401 || response.status === 403) {
      return new ProviderError(message, { code: 'auth', status: response.status })
    }

    if (response.status === 404) {
      return new ProviderError(message, { code: 'not_found', status: response.status })
    }

    if (response.status === 429) {
      return new ProviderError(message, {
        code: 'rate_limit',
        status: response.status,
        retryable: true
      })
    }

    if (response.status >= 500) {
      return new ProviderError(message, {
        code: 'server',
        status: response.status,
        retryable: true
      })
    }

    return new ProviderError(message, { code: 'bad_response', status: response.status })
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController()
    let timedOut = false

    const onAbort = (): void => controller.abort()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal })
    } catch (error) {
      if (signal?.aborted) {
        throw new ProviderError('Stopped.', { code: 'aborted', cause: error })
      }
      if (timedOut) {
        throw new ProviderError('The provider timed out.', { code: 'timeout', cause: error })
      }
      if (error instanceof ProviderError) throw error
      throw new ProviderError(
        error instanceof Error ? error.message : 'Could not reach the provider.',
        { code: 'network', retryable: true, cause: error }
      )
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  private toProviderError(error: unknown, signal?: AbortSignal): ProviderError {
    if (signal?.aborted) {
      return new ProviderError('Stopped.', { code: 'aborted', cause: error })
    }
    if (error instanceof ProviderError) return error
    if (error instanceof Error && error.name === 'AbortError') {
      return new ProviderError('The provider timed out.', { code: 'timeout', cause: error })
    }
    return new ProviderError(error instanceof Error ? error.message : String(error), {
      code: 'network',
      retryable: true,
      cause: error
    })
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra
    }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`
    return headers
  }
}

function serializeProviderMessages(
  messages: ChatRequest['messages'],
  imageUrlFormat: 'nested' | 'string'
): Array<Record<string, unknown>> {
  return messages.map((entry) => {
    const { imageAttachmentIds: _imageAttachmentIds, images, ...message } = entry
    if (entry.role !== 'user' || !images?.length) return message
    return {
      ...message,
      content: [
        { type: 'text', text: entry.content },
        ...images.map((image) => {
          const url = `data:${image.mimeType};base64,${image.data}`
          return {
            type: 'image_url',
            image_url: imageUrlFormat === 'string' ? url : { url }
          }
        })
      ]
    }
  })
}

/** Accepts a bare host and fills in /v1, which is where every local server mounts the API. */
export function normalizeBaseUrl(input: string): string {
  try {
    return normalizeProviderEndpoint(input)
  } catch (error) {
    throw new ProviderError(error instanceof Error ? error.message : String(error), {
      code: 'not_found'
    })
  }
}

function normalizeToolCalls(calls: ProviderToolCall[]): ProviderToolCall[] {
  return calls
    .filter((call) => call.function.name.trim().length > 0)
    .map((call, index) => ({
      id: call.id || `call_${index}`,
      type: 'function' as const,
      function: {
        name: call.function.name.trim(),
        arguments: call.function.arguments || '{}'
      }
    }))
}

function toUsage(usage?: {
  prompt_tokens?: number
  completion_tokens?: number
}): ChatUsage | undefined {
  if (!usage) return undefined
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens
  }
}

function extractErrorMessage(body: string): string {
  if (!body) return ''
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string
      message?: string
    }
    if (typeof parsed.error === 'string') return parsed.error
    if (parsed.error?.message) return parsed.error.message
    if (parsed.message) return parsed.message
  } catch {
    // Fall through to the raw body.
  }
  return body.slice(0, 500)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError('Stopped.', { code: 'aborted' }))
      return
    }

    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new ProviderError('Stopped.', { code: 'aborted' }))
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
