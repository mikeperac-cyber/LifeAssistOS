import {
  ProviderError,
  type ChatRequest,
  type ChatResponse,
  type ChatUsage,
  type Provider,
  type ProviderMessage,
  type ProviderToolCall
} from './types'
import { normalizeBaseUrl } from './openai-compatible'

export interface AnthropicProviderConfig {
  baseUrl: string
  model: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
  maxRetries?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_MAX_TOKENS = 4096
const ANTHROPIC_VERSION = '2023-06-01'

export function createAnthropicProvider(config: AnthropicProviderConfig): Provider {
  return new AnthropicProvider(config)
}

class AnthropicProvider implements Provider {
  readonly name = 'anthropic'
  private readonly baseUrl: string
  private readonly model: string
  private readonly apiKey?: string
  private readonly temperature: number
  private readonly defaultMaxTokens: number
  private readonly maxRetries: number
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(config: AnthropicProviderConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl)
    this.model = config.model.trim()
    this.apiKey = config.apiKey?.trim() || undefined
    this.temperature = config.temperature ?? 0.2
    this.defaultMaxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS
    this.maxRetries = Math.max(0, config.maxRetries ?? DEFAULT_MAX_RETRIES)
    this.timeoutMs = Math.max(1_000, config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
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
    const controller = new AbortController()
    const onAbort = (): void => controller.abort()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    const timer = setTimeout(() => controller.abort(), 15_000)

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: this.headers(),
        signal: controller.signal
      })

      if (response.status === 404) {
        return [
          'claude-3-5-haiku-latest',
          'claude-3-5-sonnet-latest',
          'claude-3-7-sonnet-latest'
        ]
      }

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
    } catch (error) {
      throw this.toProviderError(error, signal)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
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

    const { system, messages } = serializeAnthropicMessages(request.messages)
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      messages,
      stream: true,
      temperature: request.temperature ?? this.temperature
    }
    if (system) body.system = system
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters
      }))
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/messages`, {
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
          stop_reason?: string | null
          content?: Array<{
            type?: string
            text?: string
            id?: string
            name?: string
            input?: unknown
          }>
          usage?: { input_tokens?: number; output_tokens?: number }
        }
      | null

    if (!body || !Array.isArray(body.content)) {
      throw new ProviderError('The provider returned an invalid message response.', {
        code: 'bad_response'
      })
    }

    let text = ''
    const toolCalls: ProviderToolCall[] = []

    for (const block of body.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        text += block.text
        if (block.text) {
          markCommitted()
          request.onDelta?.(block.text)
        }
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        markCommitted()
        toolCalls.push({
          id: block.id || `toolu_${toolCalls.length}`,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {})
          }
        })
      }
    }

    const usage: ChatUsage | undefined = body.usage
      ? {
          promptTokens: body.usage.input_tokens,
          completionTokens: body.usage.output_tokens
        }
      : undefined

    return {
      text,
      toolCalls,
      finishReason: body.stop_reason ?? null,
      usage
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
    let promptTokens: number | undefined
    let completionTokens: number | undefined

    const handlePayload = (payload: string): void => {
      if (!payload || payload === '[DONE]') return
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>
      } catch {
        return
      }

      const type = parsed.type
      if (type === 'message_start') {
        const msg = parsed.message as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined
        if (typeof msg?.usage?.input_tokens === 'number') promptTokens = msg.usage.input_tokens
        if (typeof msg?.usage?.output_tokens === 'number') completionTokens = msg.usage.output_tokens
        return
      }

      if (type === 'content_block_start') {
        const index = typeof parsed.index === 'number' ? parsed.index : 0
        const block = parsed.content_block as {
          type?: string
          id?: string
          name?: string
          input?: unknown
        } | undefined
        if (block?.type === 'tool_use' && typeof block.name === 'string') {
          const initialArgs =
            block.input && typeof block.input === 'object' && Object.keys(block.input).length > 0
              ? JSON.stringify(block.input)
              : ''
          calls.set(index, {
            id: block.id || `toolu_${index}`,
            type: 'function',
            function: {
              name: block.name,
              arguments: initialArgs
            }
          })
          markCommitted()
        }
        return
      }

      if (type === 'content_block_delta') {
        const index = typeof parsed.index === 'number' ? parsed.index : 0
        const delta = parsed.delta as {
          type?: string
          text?: string
          partial_json?: string
        } | undefined
        if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
          text += delta.text
          markCommitted()
          request.onDelta?.(delta.text)
        } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          const entry = calls.get(index)
          if (entry) {
            entry.function.arguments += delta.partial_json
            markCommitted()
          }
        }
        return
      }

      if (type === 'message_delta') {
        const delta = parsed.delta as { stop_reason?: string | null } | undefined
        if (delta?.stop_reason) finishReason = delta.stop_reason
        const usage = parsed.usage as { input_tokens?: number; output_tokens?: number } | undefined
        if (typeof usage?.input_tokens === 'number') promptTokens = usage.input_tokens
        if (typeof usage?.output_tokens === 'number') completionTokens = usage.output_tokens
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

    const toolCalls = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => ({
        ...call,
        function: {
          name: call.function.name.trim(),
          arguments: call.function.arguments || '{}'
        }
      }))

    const usage: ChatUsage | undefined =
      promptTokens !== undefined || completionTokens !== undefined
        ? { promptTokens, completionTokens }
        : undefined

    return { text, toolCalls, finishReason, usage }
  }

  private async httpError(response: Response): Promise<ProviderError> {
    const body = await response.text().catch(() => '')
    let message = `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
      if (typeof parsed.error === 'string') message = parsed.error
      else if (parsed.error?.message) message = parsed.error.message
      else if (parsed.message) message = parsed.message
    } catch {
      if (body) message = body.slice(0, 500)
    }

    if (response.status === 401 || response.status === 403) {
      return new ProviderError(message, { code: 'auth', status: response.status })
    }
    if (response.status === 404) {
      return new ProviderError(message, { code: 'not_found', status: response.status })
    }
    if (response.status === 429) {
      return new ProviderError(message, { code: 'rate_limit', status: response.status, retryable: true })
    }
    if (response.status >= 500) {
      return new ProviderError(message, { code: 'server', status: response.status, retryable: true })
    }
    return new ProviderError(message, { code: 'bad_response', status: response.status })
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
      'anthropic-version': ANTHROPIC_VERSION,
      ...extra
    }
    if (this.apiKey) headers['x-api-key'] = this.apiKey
    return headers
  }
}

function serializeAnthropicMessages(messages: ProviderMessage[]): {
  system?: string
  messages: Array<Record<string, unknown>>
} {
  const systemParts: string[] = []
  const output: Array<{ role: 'user' | 'assistant'; content: unknown }> = []

  for (const entry of messages) {
    if (entry.role === 'system') {
      if (entry.content.trim()) systemParts.push(entry.content.trim())
      continue
    }

    if (entry.role === 'user') {
      if (entry.images?.length) {
        const blocks: Array<Record<string, unknown>> = []
        if (entry.content) blocks.push({ type: 'text', text: entry.content })
        for (const image of entry.images) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mimeType,
              data: image.data
            }
          })
        }
        output.push({ role: 'user', content: blocks })
      } else {
        output.push({ role: 'user', content: entry.content })
      }
      continue
    }

    if (entry.role === 'assistant') {
      if (entry.tool_calls?.length) {
        const blocks: Array<Record<string, unknown>> = []
        if (entry.content) blocks.push({ type: 'text', text: entry.content })
        for (const call of entry.tool_calls) {
          let parsedInput: Record<string, unknown> = {}
          try {
            const parsed = JSON.parse(call.function.arguments || '{}') as unknown
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              parsedInput = parsed as Record<string, unknown>
            }
          } catch {
            parsedInput = {}
          }
          blocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.function.name,
            input: parsedInput
          })
        }
        output.push({ role: 'assistant', content: blocks })
      } else {
        output.push({ role: 'assistant', content: entry.content })
      }
      continue
    }

    if (entry.role === 'tool') {
      const toolResultBlock = {
        type: 'tool_result',
        tool_use_id: entry.tool_call_id ?? 'toolu_unknown',
        content: entry.content
      }
      const previous = output[output.length - 1]
      if (
        previous &&
        previous.role === 'user' &&
        Array.isArray(previous.content) &&
        previous.content.every(
          (item) => item && typeof item === 'object' && (item as { type?: string }).type === 'tool_result'
        )
      ) {
        ;(previous.content as Array<Record<string, unknown>>).push(toolResultBlock)
      } else {
        output.push({ role: 'user', content: [toolResultBlock] })
      }
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: output
  }
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
