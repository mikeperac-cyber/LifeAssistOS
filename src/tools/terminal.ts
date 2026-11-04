import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod'
import type { ToolDef } from '../shared/types'
import { pathContext, resolveGrantPath, ToolError } from './paths'

const MAX_OUTPUT_CHARS = 20_000
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const SECRET_ENV_NAME = /(?:API.?KEY|ACCESS.?(?:TOKEN|KEY)|REFRESH.?TOKEN|AUTH(?:ORIZATION|.?TOKEN)?|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|PRIVATE.?KEY|CLIENT.?SECRET|(?:DATABASE|DB|REDIS|POSTGRES|MYSQL|MONGO|MONGODB|AMQP|RABBITMQ).?(?:URL|URI|DSN)|SSH_AUTH_SOCK|GIT_ASKPASS|NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|PYTHONPATH|PYTHONSTARTUP|PERL5OPT|RUBYOPT|BASH_ENV)/i

interface RunCommandArgs {
  root?: string
  cwd?: string
  command: string
  timeoutMs?: number
}

export interface RunCommandResult {
  cwd: string
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  stdout: string
  stderr: string
  outputTruncated: boolean
}

export const runCommandTool: ToolDef<RunCommandArgs, RunCommandResult> = {
  name: 'run_command',
  description: 'Run a shell command in a writable approved folder. Every invocation requires a typed RUN approval; command output is untrusted.',
  risk: 'command',
  timeoutMs: MAX_TIMEOUT_MS + 5_000,
  verb: 'run',
  sessionApprovalAllowed: false,
  input: z.object({
    root: z.string().optional().describe('Approved writable folder label. Omit for the primary workspace.'),
    cwd: z.string().max(1000).optional().describe('Working folder relative to the approved folder. Defaults to its root.'),
    command: z.string().min(1).max(4000).describe('Exact command to run. It will be shown in an approval card before execution.'),
    timeoutMs: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional().describe('Maximum run time in milliseconds; defaults to 30000.')
  }),
  async scope(args, context) {
    const grant = context.grants.get(args.root)
    const resolved = await resolveGrantPath(grant, args.cwd ?? '')
    const info = await stat(resolved.path)
    if (!info.isDirectory()) throw new ToolError('Choose an existing folder as the command working directory.')
    return {
      kind: 'path',
      grantId: grant.id,
      grantLabel: grant.label,
      path: resolved.path,
      relative: resolved.relative
    }
  },
  preview(args, context) {
    if (context.kind !== 'path') throw new ToolError('The command needs an approved working folder.')
    return [
      `Working folder: ${context.grant.label}/${context.relative}`,
      `Command (runs with your Windows account permissions):\n${args.command}`,
      `Time limit: ${args.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`
    ].join('\n\n')
  },
  async run(args, context) {
    const folder = pathContext(context)
    return executeCommand(args, folder.path, folder.relative, folder.signal)
  }
}

async function executeCommand(
  args: RunCommandArgs,
  cwd: string,
  relativeCwd: string,
  signal: AbortSignal
): Promise<RunCommandResult> {
  if (signal.aborted) throw new Error('The command was cancelled before it started.')

  const isWindows = process.platform === 'win32'
  const executable = isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh'
  const commandArgs = isWindows ? ['/d', '/s', '/c', `"${args.command}"`] : ['-c', args.command]
  const child = spawn(executable, commandArgs, {
    cwd,
    env: safeCommandEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: isWindows,
    detached: !isWindows
  })

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let outputTruncated = false
    let timedOut = false
    let cancelled = false
    let finished = false
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1000, args.timeoutMs ?? DEFAULT_TIMEOUT_MS))
    const timeout = setTimeout(() => {
      timedOut = true
      terminateProcessTree(child, isWindows, (timer) => { forceKillTimer = timer })
    }, timeoutMs)
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    const knownSecrets = Object.entries(process.env)
      .filter(([name]) => SECRET_ENV_NAME.test(name))
      .map(([, value]) => value)
      .filter((value): value is string => Boolean(value && value.length >= 6))

    const onAbort = (): void => {
      cancelled = true
      terminateProcessTree(child, isWindows, (timer) => { forceKillTimer = timer })
    }
    signal.addEventListener('abort', onAbort, { once: true })

    const cleanup = (): void => {
      clearTimeout(timeout)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      signal.removeEventListener('abort', onAbort)
    }
    const append = (current: string, next: string): string => {
      const remaining = MAX_OUTPUT_CHARS - current.length
      if (next.length > remaining) {
        outputTruncated = true
        return current + next.slice(0, Math.max(0, remaining))
      }
      return current + next
    }

    child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, stdoutDecoder.write(chunk)) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, stderrDecoder.write(chunk)) })
    child.once('error', (error) => {
      if (finished) return
      finished = true
      cleanup()
      reject(new Error(`Could not start the command: ${error.message}`))
    })
    child.once('close', (exitCode, childSignal) => {
      if (finished) return
      finished = true
      stdout = append(stdout, stdoutDecoder.end())
      stderr = append(stderr, stderrDecoder.end())
      cleanup()
      if (cancelled) {
        reject(new Error('The command was cancelled.'))
        return
      }
      resolve({
        cwd: relativeCwd,
        exitCode,
        signal: childSignal,
        timedOut,
        stdout: redactCommandOutput(stdout, knownSecrets),
        stderr: redactCommandOutput(stderr, knownSecrets),
        outputTruncated
      })
    })
  })
}

export function redactCommandOutput(text: string, knownSecrets: string[]): string {
  let redacted = text
  for (const secret of knownSecrets.sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(secret, '[REDACTED]')
  }
  return redacted
    .replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret|secret|password|passwd|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g, '[REDACTED]')
}

export function safeCommandEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name, value]) =>
      !SECRET_ENV_NAME.test(name) && !hasCredentialBearingUrl(value)
    )
  )
}

function hasCredentialBearingUrl(value: string | undefined): boolean {
  if (!value || !/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return false
  try {
    const url = new URL(value)
    if (url.username || url.password) return true
    return [...url.searchParams.keys()].some((key) =>
      /(?:api.?key|access.?token|auth|credential|password|passwd|secret|token)/i.test(key)
    )
  } catch {
    return false
  }
}

export function terminateProcessTree(
  child: ChildProcess,
  isWindows: boolean,
  onForceTimer: (timer: ReturnType<typeof setTimeout>) => void
): void {
  if (!child.pid) {
    child.kill()
    return
  }

  if (isWindows) {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    killer.once('error', () => child.kill())
    return
  }

  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  const forceTimer = setTimeout(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }, 1500)
  forceTimer.unref()
  onForceTimer(forceTimer)
}
