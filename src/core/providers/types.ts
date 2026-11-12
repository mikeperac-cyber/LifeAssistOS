/** OpenAI-compatible chat types. Kept separate from our domain types so the
 *  agent can translate between them in one place. */

export interface ProviderToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ProviderToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Local conversation references; stripped before the provider HTTP request. */
  imageAttachmentIds?: string[]
  /** Ephemeral image data URIs hydrated only for the current provider request. */
  images?: Array<{ mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string }>
  /** Only on assistant messages that requested tools. */
  tool_calls?: ProviderToolCall[]
  /** Only on tool messages. */
  tool_call_id?: string
}

export interface ChatRequest {
  messages: ProviderMessage[]
  tools?: ProviderToolSpec[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  /** Called for every content fragment as it arrives. */
  onDelta?: (text: string) => void
}

export interface ChatUsage {
  promptTokens?: number
  completionTokens?: number
}

export interface ChatResponse {
  text: string
  toolCalls: ProviderToolCall[]
  finishReason: string | null
  usage?: ChatUsage
}

export interface Provider {
  readonly name: string
  chat(request: ChatRequest): Promise<ChatResponse>
  listModels(signal?: AbortSignal): Promise<string[]>
}

export type ProviderErrorCode =
  | 'aborted'
  | 'timeout'
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'bad_response'
  | 'tools_unsupported'
  | 'not_found'

export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly status?: number
  readonly retryable: boolean

  constructor(
    message: string,
    options: { code: ProviderErrorCode; status?: number; retryable?: boolean; cause?: unknown }
  ) {
    super(message, { cause: options.cause })
    this.name = 'ProviderError'
    this.code = options.code
    this.status = options.status
    this.retryable = options.retryable ?? false
  }
}

/** Human-readable guidance for the settings screen and chat errors. */
export function describeProviderError(error: unknown): string {
  if (!(error instanceof ProviderError)) {
    return error instanceof Error ? error.message : String(error)
  }

  switch (error.code) {
    case 'aborted':
      return 'Stopped.'
    case 'timeout':
      return 'The model took too long to respond. Try a smaller model or a shorter request.'
    case 'auth':
      return 'The provider rejected the API key. Check it in Settings.'
    case 'rate_limit':
      return 'The provider is rate-limiting requests. Wait a moment and try again.'
    case 'server':
      return 'The provider returned a server error. Check that it is running and try again.'
    case 'not_found':
      return 'No chat endpoint was found at that base URL. It usually ends in /v1.'
    case 'tools_unsupported':
      return 'This model cannot call tools. Choose a tool-capable model such as qwen2.5:3b in Settings.'
    case 'bad_response':
      return 'The provider sent a response LifeAssistOS could not read.'
    default:
      return error.message
  }
}
