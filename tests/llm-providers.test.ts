import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAnthropicProvider } from '../src/core/providers/anthropic'
import { createProviderForSettings } from '../src/core/providers/factory'
import { PROVIDER_PRESETS, presetFor } from '../src/shared/presets'
import { SettingsStore } from '../src/core/settings'
import { Agent } from '../src/core/agent'
import { AuditLog } from '../src/core/audit/log'
import { Gateway } from '../src/core/gateway/gateway'
import { defaultPolicy } from '../src/core/gateway/policy'
import { GrantStore } from '../src/core/grants'
import { ToolRegistry } from '../src/core/registry'
import { ConversationStore } from '../src/core/conversations'
import { prepareChatImageAttachments } from '../src/core/image-attachments'
import type { ChatRequest, ChatResponse, Provider } from '../src/core/providers/types'
import { summarizeEvent } from '../src/renderer/src/components/AuditView'
import { describeEvent } from '../src/renderer/src/components/ActivityView'

interface CapturedRequest {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: unknown
}

interface TestServer {
  baseUrl: string
  requests: CapturedRequest[]
  close: () => Promise<void>
}

const openServers: TestServer[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function startServer(
  handler: (req: IncomingMessage, res: ServerResponse, body: unknown) => void
): Promise<TestServer> {
  const requests: CapturedRequest[] = []
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
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body
      })
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
      openServers.push(testServer)
      resolve(testServer)
    })
  })
}

describe('Provider presets & settings schema', () => {
  it('includes Anthropic and Google Gemini presets', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id)
    expect(ids).toContain('anthropic')
    expect(ids).toContain('gemini')
    expect(presetFor('anthropic').baseUrl).toBe('https://api.anthropic.com/v1')
    expect(presetFor('gemini').baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
  })

  it('persists anthropic/gemini presets, role models, and keepInBackground in SettingsStore', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-provider-settings-'))
    tempDirs.push(dir)
    const file = path.join(dir, 'settings.json')
    const store = new SettingsStore(file)
    await store.init()

    await store.update({
      preset: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-sonnet-latest',
      fastModel: 'claude-3-5-haiku-latest',
      visionModel: 'claude-3-5-sonnet-latest',
      keepInBackground: true
    })

    const reloaded = new SettingsStore(file)
    await reloaded.init()
    expect(reloaded.get().provider).toMatchObject({
      preset: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-sonnet-latest',
      fastModel: 'claude-3-5-haiku-latest',
      visionModel: 'claude-3-5-sonnet-latest',
      keepInBackground: true
    })
  })
})

describe('Anthropic native provider', () => {
  it('translates system, multimodal user, assistant tool_calls, and tool results to Anthropic Messages API', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_01',
          type: 'message',
          role: 'assistant',
          stop_reason: 'tool_use',
          content: [
            { type: 'text', text: 'Checking directory.' },
            {
              type: 'tool_use',
              id: 'toolu_01',
              name: 'list_dir',
              input: { path: 'docs' }
            }
          ],
          usage: {
            input_tokens: 145,
            output_tokens: 32
          }
        })
      )
    })

    const deltas: string[] = []
    const provider = createAnthropicProvider({
      baseUrl: server.baseUrl,
      model: 'claude-3-5-sonnet-latest',
      apiKey: 'sk-ant-test'
    })

    const response = await provider.chat({
      messages: [
        { role: 'system', content: 'You are Mike Assist.' },
        {
          role: 'user',
          content: 'Inspect this image and folder.',
          images: [{ mimeType: 'image/png', data: 'aGVsbG8=' }]
        },
        {
          role: 'assistant',
          content: 'I will check first.',
          tool_calls: [
            {
              id: 'toolu_prev',
              type: 'function',
              function: { name: 'list_dir', arguments: '{"path":"."}' }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'toolu_prev',
          content: '{"entries":["docs"]}'
        }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'list_dir',
            description: 'List directory contents',
            parameters: { type: 'object', properties: { path: { type: 'string' } } }
          }
        }
      ],
      onDelta: (delta) => deltas.push(delta)
    })

    expect(server.requests).toHaveLength(1)
    const req = server.requests[0]
    expect(req.url).toBe('/v1/messages')
    expect(req.headers['x-api-key']).toBe('sk-ant-test')
    expect(req.headers['anthropic-version']).toBe('2023-06-01')

    const body = req.body as Record<string, unknown>
    expect(body.system).toBe('You are Mike Assist.')
    expect(body.tools).toEqual([
      {
        name: 'list_dir',
        description: 'List directory contents',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } }
      }
    ])

    const messages = body.messages as Array<Record<string, unknown>>
    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Inspect this image and folder.' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' }
        }
      ]
    })
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will check first.' },
        { type: 'tool_use', id: 'toolu_prev', name: 'list_dir', input: { path: '.' } }
      ]
    })
    expect(messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_prev', content: '{"entries":["docs"]}' }
      ]
    })

    expect(response.text).toBe('Checking directory.')
    expect(deltas).toEqual(['Checking directory.'])
    expect(response.toolCalls).toEqual([
      {
        id: 'toolu_01',
        type: 'function',
        function: { name: 'list_dir', arguments: '{"path":"docs"}' }
      }
    ])
    expect(response.usage).toEqual({
      promptTokens: 145,
      completionTokens: 32
    })
  })

  it('streams Anthropic SSE events including text deltas, tool input_json_delta, and token usage', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const events = [
        {
          type: 'message_start',
          message: { usage: { input_tokens: 80, output_tokens: 1 } }
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' }
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello ' }
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'world!' }
        },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_stream_1', name: 'read_file', input: {} }
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"path":' }
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '"notes.md"}' }
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 24 }
        },
        {
          type: 'message_stop'
        }
      ]
      for (const evt of events) {
        res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`)
      }
      res.end()
    })

    const deltas: string[] = []
    const provider = createAnthropicProvider({
      baseUrl: server.baseUrl,
      model: 'claude-3-5-sonnet-latest',
      apiKey: 'sk-ant-stream'
    })

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Read notes.md' }],
      onDelta: (d) => deltas.push(d)
    })

    expect(result.text).toBe('Hello world!')
    expect(deltas).toEqual(['Hello ', 'world!'])
    expect(result.finishReason).toBe('tool_use')
    expect(result.toolCalls).toEqual([
      {
        id: 'toolu_stream_1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"notes.md"}' }
      }
    ])
    expect(result.usage).toEqual({
      promptTokens: 80,
      completionTokens: 24
    })
  })
})

describe('Provider factory & role routing', () => {
  it('routes anthropic preset to Anthropic adapter and selects fastModel / visionModel by role', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: 'ok' } }]
        })
      )
    })

    const anthropicProvider = createProviderForSettings({
      preset: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-sonnet-latest',
      contextLength: 8192,
      temperature: 0.2,
      maxSteps: 8
    })
    expect(anthropicProvider.name).toBe('anthropic')

    const fastProvider = createProviderForSettings(
      {
        preset: 'openai',
        baseUrl: server.baseUrl,
        model: 'gpt-4o',
        fastModel: 'gpt-4o-mini',
        visionModel: 'gpt-4o-vision',
        contextLength: 8192,
        temperature: 0.2,
        maxSteps: 8
      },
      'fast'
    )
    await fastProvider.chat({ messages: [{ role: 'user', content: 'fast task' }] })
    expect((server.requests[0].body as { model: string }).model).toBe('gpt-4o-mini')

    const visionProvider = createProviderForSettings(
      {
        preset: 'openai',
        baseUrl: server.baseUrl,
        model: 'gpt-4o',
        fastModel: 'gpt-4o-mini',
        visionModel: 'gpt-4o-vision',
        contextLength: 8192,
        temperature: 0.2,
        maxSteps: 8
      },
      'vision'
    )
    await visionProvider.chat({ messages: [{ role: 'user', content: 'vision task' }] })
    expect((server.requests[1].body as { model: string }).model).toBe('gpt-4o-vision')
  })
})

describe('Agent vision routing & token/latency telemetry', () => {
  it('routes image turns to visionProvider and records token usage and latency in audit log', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-vision-root-')))
    const auditDir = await mkdtemp(path.join(tmpdir(), 'mike-assist-vision-audit-'))
    tempDirs.push(root, auditDir)

    const audit = new AuditLog(auditDir, 'test-telemetry')
    await audit.init()
    const grants = new GrantStore(path.join(auditDir, 'grants.json'))
    await grants.init(root)
    const conversations = new ConversationStore(path.join(auditDir, 'conversations.sqlite'))
    await conversations.init()

    let defaultCalls = 0
    let visionCalls = 0

    const defaultProvider: Provider = {
      name: 'default-mock',
      chat: async (_req: ChatRequest): Promise<ChatResponse> => {
        defaultCalls += 1
        return {
          text: 'Text reply.',
          toolCalls: [],
          finishReason: 'stop',
          usage: { promptTokens: 120, completionTokens: 45 }
        }
      },
      listModels: async () => []
    }

    const visionProvider: Provider = {
      name: 'vision-mock',
      chat: async (_req: ChatRequest): Promise<ChatResponse> => {
        visionCalls += 1
        return {
          text: 'Image reply.',
          toolCalls: [],
          finishReason: 'stop',
          usage: { promptTokens: 310, completionTokens: 60 }
        }
      },
      listModels: async () => []
    }

    const registry = new ToolRegistry()
    const gateway = new Gateway({
      registry,
      policy: defaultPolicy,
      audit,
      grants,
      approve: async () => true
    })

    const agent = new Agent({
      gateway,
      audit,
      registry,
      grants,
      conversations,
      sessionId: conversations.activeSessionId() ?? undefined,
      provider: () => defaultProvider,
      visionProvider: () => visionProvider,
      settings: () => ({
        provider: {
          preset: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          visionModel: 'gpt-4o-vision',
          contextLength: 8192,
          temperature: 0.2,
          maxSteps: 8
        }
      }),
      emit: () => undefined
    })

    try {
      await agent.handleUserMessage('Hello text only')
      expect(defaultCalls).toBe(1)
      expect(visionCalls).toBe(0)

      // 1x1 PNG
      const onePixelPng =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      const attachments = prepareChatImageAttachments([
        {
          name: 'pixel.png',
          mimeType: 'image/png',
          data: onePixelPng
        }
      ])
      await agent.handleUserMessage('What is in this image?', 'assistant', attachments)
      expect(visionCalls).toBe(1)

      const events = audit.list()
      const assistantAudit = events.find(
        (evt) => evt.type === 'chat.message' && evt.data.role === 'assistant' && evt.data.promptTokens === 310
      )
      expect(assistantAudit).toBeDefined()
      expect(assistantAudit?.data.completionTokens).toBe(60)
      expect(typeof assistantAudit?.data.latencyMs).toBe('number')

      // AuditView and ActivityView formatters should surface token telemetry
      expect(summarizeEvent(assistantAudit!)).toContain('310')
      expect(describeEvent(assistantAudit!)).toContain('310')
    } finally {
      conversations.close()
    }
  })
})
