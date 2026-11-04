import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod'
import type { ToolDef, ToolResult } from '../shared/types'
import { pathContext, resolveGrantPath, ToolError } from './paths'
import { redactCommandOutput, safeCommandEnvironment, terminateProcessTree } from './terminal'

export const EXECUTE_CODE_TOOL_NAME = 'execute_code'
export const MAX_CODE_TOOL_CALLS = 32
const MAX_CODE_CHARS = 50_000
const MAX_CODE_TIMEOUT_MS = 120_000
const DEFAULT_CODE_TIMEOUT_MS = 45_000
const MAX_STREAM_CHARS = 12_000
const MAX_RPC_REQUEST_BYTES = 64_000
const MAX_RPC_RESPONSE_CHARS = 10_000

type CodeRuntime =
  | { kind: 'node'; child: ChildProcess }
  | { kind: 'utility'; child: Electron.UtilityProcess }

export const executeCodeInput = z.object({
  root: z.string().optional().describe('Approved writable folder label. Omit for the primary workspace.'),
  cwd: z.string().max(1000).optional().describe('Working folder relative to the approved folder. Defaults to its root.'),
  code: z.string().min(1).max(MAX_CODE_CHARS).describe('JavaScript to execute after typed RUN approval. Runs with your Windows account permissions.'),
  enabledTools: z.array(z.string().min(1).max(120)).max(MAX_CODE_TOOL_CALLS)
    .describe('Exact already-loaded Mike Assist tool names this script may call with await tools.call(name, args). Use an empty list when no tool calls are needed.'),
  timeoutMs: z.number().int().min(1000).max(MAX_CODE_TIMEOUT_MS).optional()
}).strict().superRefine((value, context) => {
  if (new Set(value.enabledTools).size !== value.enabledTools.length) {
    context.addIssue({ code: 'custom', path: ['enabledTools'], message: 'Tool names must be unique.' })
  }
})

type ExecuteCodeArgs = z.infer<typeof executeCodeInput>

export interface ExecuteCodeResult {
  cwd: string
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  cancelled: boolean
  deniedTool?: string
  stdout: string
  stderr: string
  toolCalls: Array<{ name: string; ok: boolean; outcomeUnknown?: boolean; durationMs?: number }>
  outcomeUnknown?: boolean
  outputTruncated: boolean
}

export const executeCodeTool: ToolDef<ExecuteCodeArgs, ExecuteCodeResult> = {
  name: EXECUTE_CODE_TOOL_NAME,
  description: 'Run a JavaScript program in a child Node.js runtime. The full script is shown in a typed RUN approval. The script can call only the exact already-loaded tools listed in enabledTools through await tools.call(name, args); those calls still pass through Mike Assist scope checks, audit, and approvals. Code runs with your Windows account permissions in a writable approved folder, so use it only for tasks the user requested.',
  risk: 'command',
  timeoutMs: MAX_CODE_TIMEOUT_MS + 5_000,
  verb: 'run',
  sessionApprovalAllowed: false,
  input: executeCodeInput,
  async scope(args, context) {
    const grant = context.grants.get(args.root)
    const resolved = await resolveGrantPath(grant, args.cwd ?? '')
    const info = await stat(resolved.path)
    if (!info.isDirectory()) throw new ToolError('Choose an existing folder as the code working directory.')
    return {
      kind: 'path',
      grantId: grant.id,
      grantLabel: grant.label,
      path: resolved.path,
      relative: resolved.relative
    }
  },
  preview(args, context) {
    if (context.kind !== 'path') throw new ToolError('Code execution needs an approved working folder.')
    return [
      `Working folder: ${context.grant.label}/${context.relative}`,
      `Allowed Mike Assist tools: ${args.enabledTools.length ? args.enabledTools.join(', ') : 'none'}`,
      `Runtime: JavaScript in a child Node.js process with your Windows account permissions. This is not an operating-system sandbox.`,
      `Time limit: ${args.timeoutMs ?? DEFAULT_CODE_TIMEOUT_MS} ms`,
      `Exact code to run:\n${args.code}`
    ].join('\n\n')
  },
  async run(args, context) {
    const folder = pathContext(context)
    if (!context.callTool) throw new Error('Programmable tool calls are available only during an interactive assistant run.')
    if (context.signal.aborted) throw new Error('Code execution was cancelled before it started.')
    return executeCode(args, folder.path, folder.relative, context.signal, context.callTool)
  }
}

async function executeCode(
  args: ExecuteCodeArgs,
  cwd: string,
  relativeCwd: string,
  signal: AbortSignal,
  callTool: (name: string, args: unknown) => Promise<ToolResult>
): Promise<ExecuteCodeResult> {
  const token = randomBytes(32).toString('hex')
  const summaries: ExecuteCodeResult['toolCalls'] = []
  let deniedTool: string | undefined
  let rpcRequestCount = 0
  let runtime: CodeRuntime | undefined
  let timedOut = false
  let cancelled = false
  let finished = false
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined
  let stdout = ''
  let stderr = ''
  let outputTruncated = false
  const stdoutDecoder = new StringDecoder('utf8')
  const stderrDecoder = new StringDecoder('utf8')

  const server = createServer((request, response) => {
    void handleRpcRequest(request, response).catch((error) => {
      sendJson(response, 500, { ok: false, error: errorMessage(error) })
    })
  })
  server.on('clientError', (_error, socket) => socket.destroy())

  const stopChild = (): void => {
    if (!runtime || finished) return
    if (runtime.kind === 'node' && (runtime.child.exitCode !== null || runtime.child.killed)) return
    if (runtime.kind === 'utility' && !runtime.child.pid) return
    const child = runtime.kind === 'node' ? runtime.child : runtime.child as unknown as ChildProcess
    terminateProcessTree(child, process.platform === 'win32', (timer) => { forceKillTimer = timer })
  }

  async function handleRpcRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== `/${token}`) {
      sendJson(response, 404, { ok: false, error: 'Unknown tool-call endpoint.' })
      return
    }
    const remoteAddress = request.socket.remoteAddress
    if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::ffff:127.0.0.1') {
      sendJson(response, 403, { ok: false, error: 'Tool-call access is limited to the local machine.' })
      return
    }
    const authorization = request.headers.authorization ?? ''
    const expected = Buffer.from(`Bearer ${token}`)
    const supplied = Buffer.from(authorization)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      sendJson(response, 403, { ok: false, error: 'Tool-call authentication failed.' })
      return
    }

    const payload = await readJsonRequest(request, response)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      if (!response.headersSent) sendJson(response, 400, { ok: false, error: 'Tool-call arguments must be a JSON object.' })
      return
    }
    const record = payload as Record<string, unknown>
    if (typeof record.tool !== 'string' || !Object.prototype.hasOwnProperty.call(record, 'args')) {
      sendJson(response, 400, { ok: false, error: 'A tool name and arguments are required.' })
      return
    }
    if (record.tool.length > 120) {
      sendJson(response, 400, { ok: false, error: 'Tool names cannot exceed 120 characters.' })
      return
    }
    if (signal.aborted || finished) {
      sendJson(response, 409, { ok: false, blocked: true, error: 'This code run is no longer active.' })
      return
    }
    rpcRequestCount += 1
    if (rpcRequestCount > MAX_CODE_TOOL_CALLS) {
      sendJson(response, 429, { ok: false, blocked: true, error: `A code run may call at most ${MAX_CODE_TOOL_CALLS} tools.` })
      setTimeout(stopChild, 75).unref()
      return
    }

    let result: ToolResult
    try {
      result = await callTool(record.tool, record.args)
    } catch (error) {
      result = { callId: '', ok: false, blocked: true, error: errorMessage(error).slice(0, 1000) }
    }
    summaries.push({
      name: record.tool,
      ok: result.ok,
      ...(result.outcomeUnknown ? { outcomeUnknown: true } : {}),
      ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs })
    })
    if (result.denied) deniedTool = record.tool

    const encoded = boundedRpcResult(result)
    sendJson(response, 200, encoded)
    if (result.denied) setTimeout(stopChild, 75).unref()
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('Could not open the local tool-call bridge.')
  }

  try {
    runtime = await launchCodeRuntime(cwd, args.code, {
      ...safeCommandEnvironment(),
      MIKE_ASSIST_TOOL_RPC_URL: `http://127.0.0.1:${address.port}/${token}`,
      MIKE_ASSIST_TOOL_RPC_TOKEN: token
    })
  } catch (error) {
    await closeServer(server)
    throw new Error(`Could not start the code runtime: ${errorMessage(error)}`)
  }

  return new Promise<ExecuteCodeResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      timedOut = true
      stopChild()
    }, Math.min(MAX_CODE_TIMEOUT_MS, Math.max(1000, args.timeoutMs ?? DEFAULT_CODE_TIMEOUT_MS)))
    const knownSecrets = [token]
    const append = (current: string, next: string): string => {
      const remaining = MAX_STREAM_CHARS - current.length
      if (next.length > remaining) {
        outputTruncated = true
        return current + next.slice(0, Math.max(0, remaining))
      }
      return current + next
    }
    const onAbort = (): void => {
      cancelled = true
      stopChild()
    }
    const cleanup = (): void => {
      clearTimeout(timeout)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      signal.removeEventListener('abort', onAbort)
      server.closeAllConnections()
      void closeServer(server)
    }

    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    runtime!.child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, stdoutDecoder.write(chunk)) })
    runtime!.child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, stderrDecoder.write(chunk)) })

    const finish = (exitCode: number | null, childSignal: string | null): void => {
      if (finished) return
      finished = true
      stdout = append(stdout, stdoutDecoder.end())
      stderr = append(stderr, stderrDecoder.end())
      cleanup()
      resolve({
        cwd: relativeCwd,
        exitCode,
        signal: childSignal,
        timedOut,
        cancelled,
        ...(deniedTool ? { deniedTool } : {}),
        ...(summaries.some((entry) => entry.outcomeUnknown) ? { outcomeUnknown: true } : {}),
        stdout: redactCommandOutput(stdout, knownSecrets),
        stderr: redactCommandOutput(stderr, knownSecrets),
        toolCalls: summaries,
        outputTruncated
      })
    }

    if (runtime!.kind === 'node') {
      runtime!.child.once('error', (error) => {
        if (finished) return
        finished = true
        cleanup()
        reject(new Error(`Could not start the code runtime: ${error.message}`))
      })
      runtime!.child.once('close', (exitCode, childSignal) => finish(exitCode, childSignal))
    } else {
      let exitCode: number | null | undefined
      let stdoutEnded = !runtime!.child.stdout
      let stderrEnded = !runtime!.child.stderr
      const finishWhenDrained = (): void => {
        if (exitCode !== undefined && stdoutEnded && stderrEnded) finish(exitCode, null)
      }
      runtime!.child.stdout?.once('end', () => { stdoutEnded = true; finishWhenDrained() })
      runtime!.child.stderr?.once('end', () => { stderrEnded = true; finishWhenDrained() })
      runtime!.child.once('error', (type, location) => {
        if (finished) return
        finished = true
        cleanup()
        reject(new Error(`The code runtime stopped after ${type} at ${location}.`))
      })
      runtime!.child.once('exit', (code) => {
        exitCode = code
        finishWhenDrained()
      })
    }
  })
}

async function launchCodeRuntime(cwd: string, code: string, env: NodeJS.ProcessEnv): Promise<CodeRuntime> {
  if (process.versions.electron) {
    const { app, utilityProcess } = await import('electron')
    if (!utilityProcess || !app.isReady()) throw new Error('Electron’s utility process is not ready.')
    const workerPath = app.isPackaged
      ? path.join(process.resourcesPath, 'code-runner-worker.cjs')
      : path.join(app.getAppPath(), 'src', 'tools', 'code-runner-worker.cjs')
    await stat(workerPath)
    const child = utilityProcess.fork(workerPath, [], {
      cwd,
      env,
      stdio: 'pipe',
      serviceName: 'Mike Assist code execution'
    })
    child.postMessage({ type: 'start', code })
    return { kind: 'utility', child }
  }

  const workerPath = path.resolve(process.cwd(), 'src', 'tools', 'code-runner-worker.cjs')
  const child = spawn(process.execPath, [workerPath], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
    detached: process.platform !== 'win32'
  })
  child.send({ type: 'start', code }, (error) => {
    if (error) child.kill()
  })
  return { kind: 'node', child }
}

async function readJsonRequest(request: IncomingMessage, response: ServerResponse): Promise<unknown | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_RPC_REQUEST_BYTES) {
        tooLarge = true
        chunks.length = 0
      } else if (!tooLarge) {
        chunks.push(buffer)
      }
    })
    request.once('error', () => resolve(null))
    request.once('end', () => {
      if (tooLarge) {
        sendJson(response, 413, { ok: false, error: 'Tool-call arguments exceeded the size limit.' })
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        sendJson(response, 400, { ok: false, error: 'Tool-call arguments were not valid JSON.' })
        resolve(null)
      }
    })
  })
}

function boundedRpcResult(result: ToolResult): Record<string, unknown> {
  try {
    const serialized = JSON.stringify(result)
    if (serialized && serialized.length <= MAX_RPC_RESPONSE_CHARS) return JSON.parse(serialized) as Record<string, unknown>
  } catch {
    // A non-JSON tool result is returned as a bounded error below.
  }
  return {
    callId: result.callId,
    ok: false,
    blocked: true,
    error: 'The tool result exceeded the code-call output limit.'
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  if (response.destroyed || response.headersSent) return
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(payload))
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

