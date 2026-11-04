import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createOpenAICompatibleProvider,
  normalizeBaseUrl
} from '../src/core/providers/openai-compatible'
import { inspectOllama, ollamaNativeBase } from '../src/core/providers/ollama'
import { describeProviderError, ProviderError } from '../src/core/providers/types'

interface Captured {
  method: string
  url: string
  body: unknown
}

interface TestServer {
  baseUrl: string
  requests: Captured[]
  close: () => Promise<void>
}

const open: TestServer[] = []

afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => server.close()))
})

function startServer(
  handler: (req: IncomingMessage, res: ServerResponse, body: unknown) => void
): Promise<TestServer> {
  const requests: Captured[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: unknown = null
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        body = raw
      }
      requests.push({ method: req.method ?? '', url: req.url ?? '', body })
      handler(req, res, body)
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      const testServer: TestServer = {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        requests,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections()
            server.close(() => done())
          })
      }
      open.push(testServer)
      resolve(testServer)
    })
  })
}

function sse(res: ServerResponse, frames: unknown[]): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  for (const frame of frames) {
    res.write(`data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`)
  }
  res.end()
}

describe('normalizeBaseUrl', () => {
  it('adds /v1 to a bare host', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434/v1')
  })

  it('strips trailing slashes and keeps an explicit path', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434/v1')
    expect(normalizeBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1')
  })

  it('rejects invalid URLs', () => {
    expect(() => normalizeBaseUrl('not a url')).toThrow(ProviderError)
    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow(ProviderError)
    expect(() => normalizeBaseUrl('')).toThrow(ProviderError)
  })

  it('requires TLS for remote endpoints and rejects URL-embedded credentials', () => {
    expect(() => normalizeBaseUrl('http://api.example.com/v1')).toThrow(/Remote provider URLs must use HTTPS/)
    expect(() => normalizeBaseUrl('https://secret@api.example.com/v1')).toThrow(/cannot contain credentials/)
    expect(() => normalizeBaseUrl('https://api.example.com/v1?key=secret')).toThrow(/query parameters/)
    expect(normalizeBaseUrl('http://localhost:1234/v1')).toBe('http://localhost:1234/v1')
  })
})

describe('OpenAI-compatible provider', () => {
  it('sends local image data as multimodal content and strips internal references', async () => {
    const server = await startServer((_req, res) => {
      sse(res, [{ choices: [{ delta: { content: 'A whiteboard.' }, finish_reason: 'stop' }] }])
    })
    const provider = createOpenAICompatibleProvider({ baseUrl: server.baseUrl, model: 'vision-model' })

    await provider.chat({
      messages: [{
        role: 'user',
        content: 'What is in this image?',
        imageAttachmentIds: ['local-attachment-id'],
        images: [{ mimeType: 'image/png', data: 'aGVsbG8=' }]
      }]
    })

    const body = server.requests[0].body as { messages: Array<Record<string, unknown>> }
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }
      ]
    })
  })

  it('uses Ollama’s documented OpenAI-compatible image URL shape when configured', async () => {
    const server = await startServer((_req, res) => {
      sse(res, [{ choices: [{ delta: { content: 'A cat.' }, finish_reason: 'stop' }] }])
    })
    const provider = createOpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: 'vision-model',
      imageUrlFormat: 'string'
    })

    await provider.chat({
      messages: [{
        role: 'user',
        content: 'What is in this image?',
        images: [{ mimeType: 'image/jpeg', data: 'aGVsbG8=' }]
      }]
    })

    const body = server.requests[0].body as { messages: Array<{ content: unknown }> }
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: 'data:image/jpeg;base64,aGVsbG8=' }
    ])
  })

  it('assembles streamed text and tool-call fragments by index', async () => {
    const server = await startServer((_req, res) => {
      sse(res, [
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'list_dir', arguments: '{"pa' } }
                ]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, function: { arguments: 'th":""}' } }] },
              finish_reason: 'tool_calls'
            }
          ]
        },
        '[DONE]'
      ])
    })

    const deltas: string[] = []
    const provider = createOpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: 'test-model'
    })

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'List files' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'list_dir',
            description: 'List',
            parameters: { type: 'object', properties: { path: { type: 'string' } } }
          }
        }
      ],
      onDelta: (text) => deltas.push(text)
    })

    expect(result.text).toBe('Hello')
    expect(deltas).toEqual(['Hel', 'lo'])
    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].id).toBe('call_1')
    expect(result.toolCalls[0].function.name).toBe('list_dir')
    expect(result.toolCalls[0].function.arguments).toBe('{"path":""}')

    const request = server.requests[0].body as { stream?: boolean; tool_choice?: string }
    expect(request.stream).toBe(true)
    expect(request.tool_choice).toBe('auto')
  })

  it('handles SSE frames split across network chunks', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const frame = `data: ${JSON.stringify({
        choices: [{ delta: { content: 'split' }, finish_reason: 'stop' }]
      })}\n\n`
      res.write(frame.slice(0, 18))
      res.write(frame.slice(18))
      res.end()
    })

    const provider = createOpenAICompatibleProvider({ baseUrl: server.baseUrl, model: 'm' })
    const result = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] })

    expect(result.text).toBe('split')
    expect(result.finishReason).toBe('stop')
  })

  it('accepts a buffered JSON response even when streaming was requested', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                content: 'Hi',
                tool_calls: [
                  {
                    id: 'call_9',
                    function: { name: 'read_file', arguments: '{"path":"a.txt"}' }
                  }
                ]
              }
            }
          ]
        })
      )
    })

    const provider = createOpenAICompatibleProvider({ baseUrl: server.baseUrl, model: 'm' })
    const result = await provider.chat({ messages: [{ role: 'user', content: 'read a.txt' }] })

    expect(result.text).toBe('Hi')
    expect(result.toolCalls[0].function.name).toBe('read_file')
  })

  it('detects models that do not support tools and does not retry', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: {
            message: 'registry.ollama.ai/library/vision:3b does not support tools'
          }
        })
      )
    })

    const provider = createOpenAICompatibleProvider({ baseUrl: server.baseUrl, model: 'vision:3b' })

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({ code: 'tools_unsupported' })

    expect(server.requests).toHaveLength(1)
  })

  it('retries a server error before any output is committed', async () => {
    let count = 0
    const server = await startServer((_req, res) => {
      count += 1
      if (count === 1) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'boom' } }))
        return
      }

      sse(res, [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
    })

    const provider = createOpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: 'm',
      maxRetries: 2
    })

    const result = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] })

    expect(result.text).toBe('ok')
    expect(server.requests).toHaveLength(2)
  })

  it('does not retry after text has already been streamed', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`)
      setTimeout(() => res.destroy(), 10)
    })

    const provider = createOpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: 'm',
      maxRetries: 2
    })

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toBeInstanceOf(ProviderError)

    expect(server.requests).toHaveLength(1)
  })

  it('rejects a cleanly truncated stream after partial output without retrying', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial answer' } }] })}\n\n`)
      res.end()
    })
    const provider = createOpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: 'm',
      maxRetries: 2
    })

    await expect(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toMatchObject({
        code: 'network',
        message: expect.stringContaining('may be incomplete')
      })
    expect(server.requests).toHaveLength(1)
  })

  it('retries an empty stream that ends before any completion marker', async () => {
    let count = 0
    const server = await startServer((_req, res) => {
      count += 1
      if (count === 1) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.end()
        return
      }
      sse(res, [{ choices: [{ delta: { content: 'recovered' }, finish_reason: 'stop' }] }])
    })
    const provider = createOpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: 'm',
      maxRetries: 1
    })

    const response = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] })

    expect(response.text).toBe('recovered')
    expect(server.requests).toHaveLength(2)
  })

  it('stops promptly when the caller aborts', async () => {
    const server = await startServer(() => {
      // Never respond; the abort must end the request.
    })

    const controller = new AbortController()
    const provider = createOpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: 'm',
      timeoutMs: 30_000
    })

    const pending = provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal
    })

    setTimeout(() => controller.abort(), 40)

    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(server.requests).toHaveLength(1)
  })

  it('honors caller cancellation after streaming response headers arrive', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`)
    })

    const controller = new AbortController()
    const provider = createOpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: 'm',
      timeoutMs: 30_000
    })

    const pending = provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 200)

    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(server.requests).toHaveLength(1)
  })

  it('applies the request timeout until the stream is fully consumed', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`)
    })

    const provider = createOpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: 'm',
      timeoutMs: 1_000,
      maxRetries: 0
    })

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({ code: 'timeout' })
    expect(server.requests).toHaveLength(1)
  })

  it('lists models from /models', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }] }))
    })

    const provider = createOpenAICompatibleProvider({ baseUrl: server.baseUrl, model: 'm' })
    expect(await provider.listModels()).toEqual(['a-model', 'b-model'])
    expect(server.requests[0].url).toBe('/v1/models')
  })

  it('sends the API key as a bearer token', async () => {
    const server = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [] }))
      expect(req.headers.authorization).toBe('Bearer secret-key')
    })

    const provider = createOpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      model: 'm',
      apiKey: 'secret-key'
    })

    await provider.listModels()
  })
})

describe('Ollama inspection', () => {
  it('derives the native API root from the OpenAI base URL', () => {
    expect(ollamaNativeBase('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434')
    expect(ollamaNativeBase('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434')
  })

  it('reports tool support, loaded context, and installed models', async () => {
    const server = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })

      if (req.url === '/api/version') {
        res.end(JSON.stringify({ version: '0.40.13' }))
        return
      }
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }, { name: 'llama3:8b' }] }))
        return
      }
      if (req.url === '/api/show') {
        res.end(
          JSON.stringify({
            capabilities: ['completion', 'tools'],
            model_info: { 'qwen2.context_length': 32768 }
          })
        )
        return
      }
      if (req.url === '/api/ps') {
        res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b', context_length: 8192 }] }))
        return
      }

      res.end(JSON.stringify({}))
    })

    const info = await inspectOllama(server.baseUrl, 'qwen2.5:3b')

    expect(info.version).toBe('0.40.13')
    expect(info.models).toEqual(['llama3:8b', 'qwen2.5:3b'])
    expect(info.supportsTools).toBe(true)
    expect(info.loadedContext).toBe(8192)
    expect(info.maxContext).toBe(32768)
  })

  it('falls back to the template when capabilities are absent', async () => {
    const server = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })

      if (req.url === '/api/version') {
        res.end(JSON.stringify({ version: '0.40.13' }))
        return
      }
      if (req.url === '/api/show') {
        res.end(JSON.stringify({ template: '{{ if .Tools }}tools{{ end }}' }))
        return
      }

      res.end(JSON.stringify({ models: [] }))
    })

    const info = await inspectOllama(server.baseUrl, 'qwen2.5:3b')
    expect(info.supportsTools).toBe(true)
  })
})

describe('describeProviderError', () => {
  it('explains tool-incapable models in plain language', () => {
    const message = describeProviderError(
      new ProviderError('does not support tools', { code: 'tools_unsupported' })
    )
    expect(message).toContain('cannot call tools')
    expect(message).toContain('qwen2.5:3b')
  })

  it('passes through unknown errors', () => {
    expect(describeProviderError(new Error('plain failure'))).toBe('plain failure')
  })
})
