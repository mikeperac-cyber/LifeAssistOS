import { Ajv, type ValidateFunction } from 'ajv'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  ListToolsResult,
  Tool
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type {
  McpServerInfo,
  McpServerRecord,
  McpStatus,
  McpToolInfo,
  ToolDef
} from '../../shared/types'
import type { AuditLog } from '../audit/log'
import type { ToolRegistry } from '../registry'
import { describeServer, invocationName, sanitizeSegment } from './naming'
import type { McpServerStore } from './store'

const CONNECT_TIMEOUT_MS = 15_000
const CALL_TIMEOUT_MS = 120_000
const MAX_TOOLS_PER_SERVER = 24
const MAX_TOOL_DESCRIPTION_CHARS = 300
const MAX_TOOL_RESULT_TEXT_CHARS = 24_000

/** Narrow validator surface the tool input refinement needs. */
interface SchemaValidator {
  safeParse(value: unknown):
    | { success: true }
    | { success: false; issues: Array<{ path: string[]; message: string }> }
}

export interface McpManagerOptions {
  registry: ToolRegistry
  audit: AuditLog
  clientVersion: string
  /** Injectable limits keep timeout behavior testable without slow tests. */
  connectTimeoutMs?: number
  callTimeoutMs?: number
  /** Builds the raw transport; overridable for tests. */
  transportFor?: (record: McpServerRecord) => Transport
  /** Announced whenever registered MCP tools change. */
  onToolsChanged?: (serverId: string) => void
}

/**
 * Owns one MCP client per enabled, saved server. Tools register with risk
 * "external" and always prompt for approval: server annotations are untrusted
 * data, never permissions. The client declares no capabilities, so
 * sampling/roots/elicitation requests from servers are refused (deferred).
 */
export class McpServerManager {
  private readonly clients = new Map<string, Client>()
  private readonly registeredToolNames = new Map<string, string[]>()
  private readonly states = new Map<string, ServerState>()
  private readonly chains = new Map<string, Promise<void>>()

  constructor(
    private readonly store: McpServerStore,
    private readonly options: McpManagerOptions
  ) {}

  async init(): Promise<void> {
    for (const record of this.store.list()) {
      if (!record.enabled) {
        this.states.set(record.id, { status: 'disabled', tools: [], truncated: false })
        continue
      }
      // Connections run in the background so a slow server never delays startup.
      void this.connect(record.id).catch(() => undefined)
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.clients.keys()].map((serverId) => this.silentlyDisconnect(serverId)))
  }

  info(): McpServerInfo[] {
    return this.store.list().map((record) => {
      const state = this.states.get(record.id) ?? { status: 'disabled' as McpStatus, tools: [], truncated: false }
      return {
        id: record.id,
        name: record.name,
        transport: record.transport,
        detail: describeServer(record),
        enabled: record.enabled,
        status: state.status,
        error: state.error,
        tools: state.tools,
        truncated: state.truncated
      }
    })
  }

  /** Serialized per server so connect/disconnect/refresh never interleave. */
  private chainFor(serverId: string): Promise<void> {
    const current = this.chains.get(serverId) ?? Promise.resolve()
    const next = current.then(() => undefined, () => undefined)
    this.chains.set(serverId, next)
    return next
  }

  queueConnect(serverId: string): Promise<void> {
    return this.chainFor(serverId).then(async () => {
      const record = this.store.get(serverId)
      if (!record.enabled) {
        await this.silentlyDisconnect(serverId)
        this.states.set(serverId, { status: 'disabled', tools: [], truncated: false })
        return
      }
      await this.connect(serverId)
    })
  }

  queueDisable(serverId: string): Promise<void> {
    return this.chainFor(serverId).then(async () => {
      await this.silentlyDisconnect(serverId)
      this.states.set(serverId, { status: 'disabled', tools: [], truncated: false })
    })
  }

  queueRemove(serverId: string): Promise<void> {
    return this.chainFor(serverId).then(async () => {
      await this.silentlyDisconnect(serverId)
      this.states.delete(serverId)
    })
  }

  /** Re-lists tools for a connected server. */
  queueRefresh(serverId: string): Promise<void> {
    return this.queueConnect(serverId)
  }

  // ---- internals ----

  private async silentlyDisconnect(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    const wasRegistered = this.registeredToolNames.get(serverId)?.length ?? 0
    this.clients.delete(serverId)

    for (const name of this.registeredToolNames.get(serverId) ?? []) {
      try {
        this.options.registry.unregister(name)
      } catch {
        // already gone
      }
    }
    this.registeredToolNames.set(serverId, [])

    if (client || wasRegistered > 0) {
      try {
        await this.options.audit.append({ type: 'mcp.disconnected', data: { removed: wasRegistered } })
      } catch (error) {
        console.error('[mcp] audit write failed', error)
      }
      this.options.onToolsChanged?.(serverId)
    }

    if (client) {
      try {
        await client.close()
      } catch {
        // closing a broken transport is best-effort
      }
    }
  }

  private async connect(serverId: string): Promise<void> {
    let record: McpServerRecord
    try {
      record = this.store.get(serverId)
    } catch {
      this.states.delete(serverId)
      return
    }

    await this.silentlyDisconnect(serverId)
    this.states.set(serverId, { status: 'connecting', tools: [], truncated: false })

    let client: Client | undefined
    try {
      client = new Client(
        { name: 'Mike Assist', version: this.options.clientVersion },
        { capabilities: {} } // no elicitation, sampling, or roots in v1
      )
      // Make the refusal of server-initiated requests explicit and readable.
      client.fallbackRequestHandler = async (request) => {
        throw new Error(
          `Mike Assist declined the server-initiated "${request.method}" request; only tools you call are allowed.`
        )
      }

      const transport = this.buildTransport(record)
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined
      try {
        const deadline = new Promise<never>((_resolve, reject) => {
          deadlineTimer = setTimeout(
            () => reject(new Error('The MCP server took too long to connect.')),
            this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
          )
        })
        await Promise.race([client.connect(transport), deadline])
      } finally {
        if (deadlineTimer) clearTimeout(deadlineTimer)
      }

      this.clients.set(serverId, client)
      const listed = await client.listTools()
      this.commitTools(serverId, record, listed)
      await this.options.audit
        .append({ type: 'mcp.connected', data: { toolCount: listed.tools.length } })
        .catch(() => undefined)
    } catch (error) {
      try {
        await client?.close()
      } catch {
        // best-effort close
      }
      this.clients.delete(serverId)
      this.registeredToolNames.set(serverId, [])
      const message = describeClientError(error)
      this.states.set(serverId, { status: 'error', error: message, tools: [], truncated: false })
      await this.options.audit.append({ type: 'mcp.failed', data: {} }).catch(() => undefined)
    }
  }

  private commitTools(serverId: string, record: McpServerRecord, listed: ListToolsResult): void {
    for (const name of this.registeredToolNames.get(serverId) ?? []) {
      try {
        this.options.registry.unregister(name)
      } catch {
        // already gone
      }
    }

    const registered: string[] = []
    const infos: McpToolInfo[] = []
    for (const tool of listed.tools) {
      if (infos.length === MAX_TOOLS_PER_SERVER) break
      const invocation = invocationName(record.name, tool.name)
      if (registered.includes(invocation)) continue
      const def = createToolDef(record, tool, invocation, {
        timeoutMs: this.options.callTimeoutMs ?? CALL_TIMEOUT_MS,
        getClient: () => this.clients.get(record.id)
      })
      try {
        this.options.registry.register(def)
      } catch (error) {
        console.warn(`[mcp] could not register "${invocation}"`, error)
        continue
      }
      registered.push(invocation)
      infos.push({
        invocationName: invocation,
        toolName: tool.name,
        description: (tool.description ?? '').slice(0, MAX_TOOL_DESCRIPTION_CHARS)
      })
    }

    const total = listed.tools.length
    this.registeredToolNames.set(serverId, registered)
    this.states.set(serverId, {
      status: 'connected',
      tools: infos,
      truncated: total > MAX_TOOLS_PER_SERVER
    })

    void this.options.audit
      .append({ type: 'mcp.tools_changed', data: { registered: registered.length, exposed: total } })
      .catch((error) => console.error('[mcp] audit write failed', error))
    this.options.onToolsChanged?.(serverId)
  }

  private buildTransport(record: McpServerRecord): Transport {
    if (this.options.transportFor) return this.options.transportFor(record)

    if (record.transport === 'http') {
      return new StreamableHTTPClientTransport(new URL(record.url!), {
        requestInit: { headers: { 'User-Agent': 'MikeAssist/1.0 (+local-first)' } }
      })
    }

    return new StdioClientTransport({
      command: record.command!,
      args: record.args ?? [],
      stderr: 'ignore'
    })
  }
}

interface ServerState {
  status: McpStatus
  error?: string
  tools: McpToolInfo[]
  truncated: boolean
}

// ---- tool def factory ----

function createToolDef(
  record: McpServerRecord,
  tool: Tool,
  invocation: string,
  runtime: { getClient: () => Client | undefined; timeoutMs: number }
): ToolDef<Record<string, unknown>, unknown> {
  const serverLabel = sanitizeSegment(record.name, 18)
  const validate = compileValidator(tool.inputSchema)

  return {
    name: invocation,
    description: `MCP tool "${tool.name}" on server ${serverLabel}. ${tool.description ?? ''}`
      .trim()
      .slice(0, 700),
    risk: 'external',
    sessionApprovalAllowed: false,
    input: z.any().superRefine((value, ctx) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MCP tool arguments must be an object.' })
        return
      }
      const checked = validate.safeParse(value)
      if (!checked.success) {
        const issue = checked.issues[0]
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid arguments${issue?.path.length ? ` for ${issue.path.join('.')}` : ''}: ${issue?.message ?? 'schema mismatch'}`
        })
      }
    }),
    scope() {
      return { kind: 'none' }
    },
    preview(args) {
      return `Server: ${serverLabel}\nTool: ${tool.name}\nArguments: ${summarizeArgs(args)}\n\nThe tool result is treated as untrusted data.`
    },
    async run(args, context) {
      const client = runtime.getClient()
      if (!client) throw new Error('The MCP server disconnected before this call ran; nothing was executed.')

      const controller = new AbortController()
      const onAbort = (): void => controller.abort(context.signal.reason)
      if (context.signal.aborted) onAbort()
      else context.signal.addEventListener('abort', onAbort, { once: true })
      let result: unknown
      try {
        result = await client.callTool(
          { name: tool.name, arguments: args },
          undefined,
          {
            signal: controller.signal,
            timeout: runtime.timeoutMs,
            maxTotalTimeout: runtime.timeoutMs
          }
        )
      } finally {
        context.signal.removeEventListener('abort', onAbort)
        if (context.signal.aborted) throw new Error('The MCP tool call was cancelled.')
      }
      return normalizeToolResult(result)
    }
  }
}

function compileValidator(schema: unknown): SchemaValidator {
  const objectSchema = (schema && typeof schema === 'object' ? schema : { type: 'object' }) as object
  let compiled: ValidateFunction<unknown>
  try {
    compiled = new Ajv({ strict: false, validateSchema: false }).compile(objectSchema)
  } catch {
    compiled = new Ajv({ strict: false, validateSchema: false }).compile({ type: 'object' })
  }

  return {
    safeParse(value: unknown) {
      if (compiled(value) === true) return { success: true } as const
      const issues = (compiled.errors ?? [])
        .filter((entry) => typeof entry === 'object')
        .map((entry) => ({
          path: (entry.instancePath ?? '').split('/').filter(Boolean),
          message: entry.message ?? 'is invalid'
        }))
      return { success: false, issues } as const
    }
  }
}

function normalizeToolResult(result: unknown): unknown {
  const record = (result ?? {}) as {
    content?: Array<{ type?: string; text?: string; uri?: string }>
    isError?: boolean
    structuredContent?: unknown
  }

  const lines: string[] = []
  for (const entry of record.content ?? []) {
    if (entry.type === 'text' && typeof entry.text === 'string') lines.push(entry.text)
    else if (entry.type === 'image') lines.push('[MCP tool returned an image; not shown in chat]')
    else if (entry.type === 'audio') lines.push('[MCP tool returned audio; not shown in chat]')
    else if (entry.type === 'resource_link' && typeof entry.uri === 'string') lines.push(`[resource link: ${entry.uri}]`)
    else lines.push('[Unsupported MCP content type (not shown in chat).]')
  }

  const joined = lines.join('\n\n')
  const truncated = joined.length > MAX_TOOL_RESULT_TEXT_CHARS
  return {
    ok: record.isError !== true,
    text: truncated ? `${joined.slice(0, MAX_TOOL_RESULT_TEXT_CHARS)}\n… (truncated by Mike Assist)` : joined,
    structuredContent: record.structuredContent ?? undefined,
    truncatedByMikeAssist: truncated
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  try {
    const serialized = JSON.stringify(args)
    if (serialized.length <= 400) return serialized
    return `${serialized.slice(0, 400)}… (+${serialized.length - 400} chars)`
  } catch {
    return '[unprintable arguments]'
  }
}

function describeClientError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/ENOENT|not found|404/i.test(raw)) return 'Could not launch the command. Check the path (Mike Assist never installs anything).'
  if (/EACCES|permission/i.test(raw)) return 'The operating system refused to launch this command.'
  if (/timed out|too long/i.test(raw)) return 'The MCP server did not answer in time.'
  return raw.slice(0, 240)
}
