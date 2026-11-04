import { createHash, randomUUID } from 'node:crypto'
import type {
  FolderGrant,
  ApprovalChoice,
  Decision,
  PermissionRequest,
  PermissionVerb,
  Risk,
  ToolCall,
  ToolContext,
  ToolDef,
  ToolResult,
  ToolRuntime,
  ToolScope
} from '../../shared/types'
import { isPathInside, ToolError } from '../../tools/paths'
import type { AuditLog } from '../audit/log'
import type { GrantStore } from '../grants'
import type { ToolRegistry } from '../registry'
import { approvalFingerprint, SessionApprovalStore } from './session-approvals'
import { isMutating, resolveDecision, type PolicyConfig } from './policy'

export type ApprovalBroker = (
  request: PermissionRequest,
  signal: AbortSignal
) => Promise<ApprovalChoice | boolean>

/**
 * Typed-confirmation copy for close-to-irreversible verbs. The user must type
 * the token exactly before the gateway accepts an approval, and no session
 * approval is ever offered for these actions.
 */
const VERB_CONFIRMATIONS: Record<PermissionVerb, { verb: PermissionVerb; prompt: string; expects: string }> = {
  send: {
    verb: 'send',
    prompt: 'This will send something to a real recipient outside this app.',
    expects: 'SEND'
  },
  delete: {
    verb: 'delete',
    prompt: 'This permanently removes data and cannot be undone from Mike Assist.',
    expects: 'DELETE'
  },
  post: {
    verb: 'post',
    prompt: 'This publishes content where other people can see it.',
    expects: 'POST'
  },
  buy: {
    verb: 'buy',
    prompt: 'This can move or spend real money.',
    expects: 'BUY'
  },
  run: {
    verb: 'run',
    prompt: 'This runs an external process on this computer.',
    expects: 'RUN'
  }
}

export interface GatewayOptions {
  registry: ToolRegistry
  policy: PolicyConfig
  audit: AuditLog
  /** Re-read at execution time so revocations take effect immediately. */
  grants: GrantStore
  approve: ApprovalBroker
  sessionApprovals?: SessionApprovalStore
  sessionId?: () => string
  externalHostAllowed?: (host: string) => boolean
  toolTimeoutMs?: number
}

interface AskResult {
  choice: ApprovalChoice
  expired: boolean
  cancelled: boolean
}

type ScopeCheck =
  | { ok: true; grant?: FolderGrant }
  | { ok: false; reason: string }

const DEFAULT_TOOL_TIMEOUT_MS = 20_000

export class Gateway {
  private readonly toolTimeoutMs: number

  constructor(private readonly options: GatewayOptions) {
    this.toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  }

  riskOf(name: string): Risk | undefined {
    return this.options.registry.riskOf(name)
  }

  decisionFor(name: string): Decision | undefined {
    const tool = this.options.registry.get(name)
    return tool ? resolveDecision(name, tool.risk, this.options.policy).decision : undefined
  }

  async execute(call: ToolCall, signal?: AbortSignal, runtime?: ToolRuntime): Promise<ToolResult> {
    const startedAt = Date.now()
    const tool = this.options.registry.get(call.name)

    try {
      await this.options.audit.append({
        type: 'call.proposed',
        callId: call.id,
        data: {
          tool: call.name,
          summary: call.summary ?? null,
          argsHash: hashArgs(call.args),
          tainted: call.tainted ?? false
        }
      })
    } catch (error) {
      return this.failClosed(call, 'audit unavailable before call', error, startedAt)
    }

    if (signal?.aborted) return this.cancelled(call, startedAt)

    if (!tool) {
      return this.block(call, `Unknown tool "${call.name}".`, startedAt)
    }

    let args: unknown
    try {
      args = tool.input.parse(call.args)
    } catch (error) {
      return this.block(call, `Invalid arguments for "${call.name}": ${describeError(error)}`, startedAt)
    }

    let scope: ToolScope
    try {
      scope =
        (await tool.scope?.(args, {
          grants: this.options.grants,
          primaryGrantId: this.options.grants.primary().id
        })) ?? { kind: 'none' }
    } catch (error) {
      return this.block(call, describeError(error), startedAt)
    }

    const initialCheck = this.validateScope(scope, tool.risk)
    if (!initialCheck.ok) {
      return this.block(call, initialCheck.reason, startedAt)
    }

    const { decision, reason } = resolveDecision(tool.name, tool.risk, this.options.policy)

    try {
      await this.options.audit.append({
        type: 'policy.decided',
        callId: call.id,
        data: {
          tool: tool.name,
          risk: tool.risk,
          decision,
          reason,
          grant: scope.kind === 'path' ? scope.grantLabel : null
        }
      })
    } catch (error) {
      return this.failClosed(call, 'audit unavailable after policy decision', error, startedAt)
    }

    if (decision === 'block') {
      return this.block(call, reason, startedAt)
    }

    const context = this.buildContext(scope, signal ?? new AbortController().signal)

    if (decision === 'ask') {
      const sessionId = this.options.sessionId?.() ?? ''
      const fingerprint = approvalFingerprint({ tool: tool.name, risk: tool.risk, scope, args })
      const confirm = tool.verb ? VERB_CONFIRMATIONS[tool.verb] : undefined
      const sessionApprovalAllowed = tool.sessionApprovalAllowed !== false && confirm === undefined
      const alreadyApproved =
        sessionApprovalAllowed && sessionId.length > 0 && this.options.sessionApprovals?.has(sessionId, fingerprint)

      if (alreadyApproved) {
        try {
          await this.options.audit.append({
            type: 'approval.session_granted',
            callId: call.id,
            data: { tool: tool.name, risk: tool.risk, scope: describeScope(scope), fingerprint }
          })
        } catch (error) {
          return this.failClosed(call, 'audit unavailable for session approval', error, startedAt)
        }
      } else {
        let preview: string | undefined
        try {
          preview = tool.preview ? await tool.preview(args, context) : undefined
        } catch (error) {
          return this.block(call, `Could not prepare a preview: ${describeError(error)}`, startedAt)
        }

        const request: PermissionRequest = {
          id: randomUUID(),
          callId: call.id,
          tool: tool.name,
          risk: tool.risk,
          summary: call.summary ?? tool.description,
          preview,
          scope: describeScope(scope),
          path: scope.kind === 'path' ? scope.path : undefined,
          grantLabel: scope.kind === 'path' ? scope.grantLabel : undefined,
          tainted: call.tainted ?? false,
          sessionApprovalAllowed,
          confirm
        }

        try {
          await this.options.audit.append({
            type: 'approval.requested',
            callId: call.id,
            data: {
              requestId: request.id,
              tool: tool.name,
              risk: tool.risk,
              scope: request.scope ?? null,
              tainted: request.tainted ?? false
            }
          })
        } catch (error) {
          return this.failClosed(call, 'audit unavailable before approval', error, startedAt)
        }

        const outcome = await this.ask(request, signal)
        const approvedMode = outcome.choice === 'session' && !sessionApprovalAllowed ? 'once' : outcome.choice

        if (approvedMode === 'deny') {
          await this.options.audit
            .append({
              type: outcome.cancelled
                ? 'approval.cancelled'
                : outcome.expired
                  ? 'approval.expired'
                  : 'approval.denied',
              callId: call.id,
              data: { requestId: request.id, tool: tool.name }
            })
            .catch((error) => console.error('[gateway] audit write failed', error))

          return {
            callId: call.id,
            ok: false,
            denied: true,
            error: outcome.cancelled
              ? 'The action was cancelled before approval.'
              : outcome.expired
                ? 'Approval timed out, so the action was denied.'
                : 'You denied this action, so nothing was changed.',
            durationMs: Date.now() - startedAt
          }
        }

        try {
          await this.options.audit.append({
            type: 'approval.granted',
            callId: call.id,
            data: {
              requestId: request.id,
              tool: tool.name,
              mode: approvedMode,
              sessionId: approvedMode === 'session' ? sessionId : undefined,
              fingerprint: approvedMode === 'session' ? fingerprint : undefined
            }
          })
        } catch (error) {
          return this.failClosed(call, 'audit unavailable after approval', error, startedAt)
        }

        if (approvedMode === 'session' && sessionId) {
          this.options.sessionApprovals?.remember(sessionId, fingerprint)
        }
      }
    }

    if (signal?.aborted) return this.cancelled(call, startedAt)

    // Re-validate after approval: a grant may have been revoked or downgraded
    // while the dialog was open.
    const finalCheck = this.validateScope(scope, tool.risk)
    if (!finalCheck.ok) {
      return this.block(call, finalCheck.reason, startedAt)
    }

    try {
      await this.options.audit.append({
        type: 'call.started',
        callId: call.id,
        data: { tool: tool.name }
      })
    } catch (error) {
      return this.failClosed(call, 'audit unavailable before execution', error, startedAt)
    }

    if (signal?.aborted) return this.cancelled(call, startedAt)

    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let rejectCancelled: (reason: Error) => void = () => undefined
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancelled = reject
    })
    const onAbort = (): void => {
      controller.abort()
      rejectCancelled(new Error('Tool cancelled.'))
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error('Tool timed out.'))
      }, tool.timeoutMs ?? this.toolTimeoutMs)
    })

    try {
      const output = await Promise.race([
        tool.run(args, this.buildContext(scope, controller.signal, runtime)),
        timeout,
        cancelled
      ])

      const terminalState = toolTerminalState(output, tool)
      if (terminalState) {
        const outcomeUnknown = terminalState === 'outcome_unknown' || mayHaveSideEffectsOnFailure(tool)
        const message = terminalState === 'timed_out'
          ? outcomeUnknown
            ? 'The tool timed out and its outcome is unknown. Check the current state before retrying.'
            : 'The tool timed out before it finished.'
          : terminalState === 'command_failed'
            ? 'The command did not finish successfully and may have partially completed. Check the current state before retrying.'
          : terminalState === 'cancelled'
            ? outcomeUnknown
              ? 'The action was cancelled, but its outcome is unknown. Check the current state before retrying.'
              : 'The action was cancelled.'
            : 'A nested action may have completed, but its outcome is unknown. Check the current state before retrying.'
        const cancelledByUser = terminalState === 'cancelled'
        await this.options.audit.append({
          type: cancelledByUser ? 'call.cancelled' : 'call.failed',
          callId: call.id,
          data: { tool: tool.name, error: message, outcomeUnknown }
        }).catch((error) => console.error('[gateway] audit write failed', error))
        return {
          callId: call.id,
          ok: false,
          ...(cancelledByUser ? { denied: true } : {}),
          ...(outcomeUnknown ? { outcomeUnknown: true } : {}),
          error: message,
          output,
          durationMs: Date.now() - startedAt
        }
      }

      await this.options.audit
        .append({
          type: 'call.completed',
          callId: call.id,
          data: { tool: tool.name, durationMs: Date.now() - startedAt }
        })
        .catch((error) => console.error('[gateway] audit write failed', error))

      return {
        callId: call.id,
        ok: true,
        output,
        durationMs: Date.now() - startedAt
      }
    } catch (error) {
      const reportedUnknown = error instanceof ToolError && error.outcomeUnknown
      if (signal?.aborted) {
        const outcomeUnknown = reportedUnknown || mayHaveSideEffectsOnFailure(tool)
        const message = outcomeUnknown
          ? `${describeError(error)} The action's outcome is unknown; check the current state before retrying.`
          : 'The action was cancelled.'
        await this.options.audit
          .append({ type: 'call.cancelled', callId: call.id, data: { tool: tool.name, outcomeUnknown } })
          .catch((auditError) => console.error('[gateway] audit write failed', auditError))
        return {
          callId: call.id,
          ok: false,
          denied: true,
          ...(outcomeUnknown ? { outcomeUnknown: true } : {}),
          error: message,
          durationMs: Date.now() - startedAt
        }
      }

      const timedOut = controller.signal.aborted
      const outcomeUnknown = reportedUnknown || (timedOut && mayHaveSideEffectsOnFailure(tool))
      const message = timedOut
        ? outcomeUnknown
          ? 'The tool timed out and its outcome is unknown. Check the current state before retrying.'
          : 'The tool timed out before it finished.'
        : outcomeUnknown
          ? `${describeError(error)} The remote outcome is unknown; check the current state before retrying.`
          : describeError(error)

      await this.options.audit
        .append({
          type: 'call.failed',
          callId: call.id,
          data: { tool: tool.name, error: message, outcomeUnknown }
        })
        .catch((auditError) => console.error('[gateway] audit write failed', auditError))

      return {
        callId: call.id,
        ok: false,
        ...(outcomeUnknown ? { outcomeUnknown: true } : {}),
        error: message,
        durationMs: Date.now() - startedAt
      }
    } finally {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /** Confirms the scope still points at an approved, sufficiently-writable folder. */
  private validateScope(scope: ToolScope, risk: Risk): ScopeCheck {
    if (scope.kind === 'none') return { ok: true }

    if (scope.kind === 'url') {
      if (risk !== 'external' || !this.options.externalHostAllowed) {
        return { ok: false, reason: 'External tools are not enabled in this build.' }
      }

      try {
        const url = new URL(scope.url)
        if (
          url.protocol !== 'https:' ||
          url.hostname.toLowerCase() !== scope.host.toLowerCase() ||
          url.username ||
          url.password ||
          (url.port && url.port !== '443') ||
          !this.options.externalHostAllowed(scope.host)
        ) {
          return {
            ok: false,
            reason: 'The URL is not HTTPS or its exact domain is not on the user allowlist.'
          }
        }
        return { ok: true }
      } catch {
        return { ok: false, reason: 'The external URL is invalid.' }
      }
    }

    const grant = this.options.grants.list().find((entry) => entry.id === scope.grantId)
    if (!grant) {
      return { ok: false, reason: `The "${scope.grantLabel}" folder is no longer approved.` }
    }

    if (!isPathInside(grant.root, scope.path)) {
      return { ok: false, reason: `Path is outside the "${grant.label}" folder.` }
    }

    if (isMutating(risk) && grant.access !== 'read-write') {
      return {
        ok: false,
        reason: `The "${grant.label}" folder is read-only. Change its access in Settings to allow writes.`
      }
    }

    return { ok: true, grant }
  }

  private buildContext(scope: ToolScope, signal: AbortSignal, runtime?: ToolRuntime): ToolContext {
    if (scope.kind === 'path') {
      const grant = this.options.grants.list().find((entry) => entry.id === scope.grantId)
      if (!grant) {
        throw new Error(`The "${scope.grantLabel}" folder is no longer approved.`)
      }
      return {
        kind: 'path',
        signal,
        ...(runtime?.callTool ? { callTool: runtime.callTool } : {}),
        path: scope.path,
        grant,
        relative: scope.relative
      }
    }

    return { kind: 'none', signal, ...(runtime?.callTool ? { callTool: runtime.callTool } : {}) }
  }

  private async ask(request: PermissionRequest, parentSignal?: AbortSignal): Promise<AskResult> {
    const controller = new AbortController()
    let expired = false
    const timer = setTimeout(() => {
      expired = true
      controller.abort()
    }, this.options.policy.approvalTimeoutMs)
    const onParentAbort = (): void => controller.abort()
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort()
      else parentSignal.addEventListener('abort', onParentAbort, { once: true })
    }

    let choice: ApprovalChoice = 'deny'
    try {
      const response = await new Promise<ApprovalChoice | boolean>((resolve, reject) => {
        if (controller.signal.aborted) {
          resolve('deny')
          return
        }
        const onAbort = (): void => resolve('deny')
        controller.signal.addEventListener('abort', onAbort, { once: true })

        this.options.approve(request, controller.signal).then(
          (value) => {
            controller.signal.removeEventListener('abort', onAbort)
            resolve(value)
          },
          (error) => {
            controller.signal.removeEventListener('abort', onAbort)
            reject(error)
          }
        )
      })
      choice = normalizeChoice(response)
    } catch (error) {
      console.error('[gateway] approval broker failed', error)
      choice = 'deny'
    } finally {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParentAbort)
    }

    return {
      choice,
      expired: choice === 'deny' && expired,
      cancelled: choice === 'deny' && Boolean(parentSignal?.aborted)
    }
  }

  private async cancelled(call: ToolCall, startedAt: number): Promise<ToolResult> {
    await this.options.audit
      .append({ type: 'call.cancelled', callId: call.id, data: { tool: call.name } })
      .catch((error) => console.error('[gateway] audit write failed', error))
    return {
      callId: call.id,
      ok: false,
      denied: true,
      error: 'The action was cancelled.',
      durationMs: Date.now() - startedAt
    }
  }

  private async failClosed(
    call: ToolCall,
    context: string,
    error: unknown,
    startedAt: number
  ): Promise<ToolResult> {
    console.error(`[gateway] ${context}`, error)
    return {
      callId: call.id,
      ok: false,
      blocked: true,
      error: 'The audit log is unavailable, so the action was blocked.',
      durationMs: Date.now() - startedAt
    }
  }

  private async block(call: ToolCall, reason: string, startedAt: number): Promise<ToolResult> {
    await this.options.audit
      .append({
        type: 'call.blocked',
        callId: call.id,
        data: { tool: call.name, reason }
      })
      .catch((error) => console.error('[gateway] audit write failed', error))

    return {
      callId: call.id,
      ok: false,
      blocked: true,
      error: reason,
      durationMs: Date.now() - startedAt
    }
  }
}

function toolTerminalState(output: unknown, tool: ToolDef): 'timed_out' | 'cancelled' | 'command_failed' | 'outcome_unknown' | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  const record = output as Record<string, unknown>
  if (record.timedOut === true) return 'timed_out'
  if (record.cancelled === true) return 'cancelled'
  if (record.outcomeUnknown === true) return 'outcome_unknown'
  if (
    tool.risk === 'command' &&
    ((typeof record.exitCode === 'number' && record.exitCode !== 0) ||
      (record.exitCode === null && typeof record.signal === 'string' && record.signal.length > 0))
  ) return 'command_failed'
  return null
}

function mayHaveSideEffectsOnFailure(tool: ToolDef): boolean {
  if (tool.mayHaveSideEffectsOnFailure !== undefined) return tool.mayHaveSideEffectsOnFailure
  return tool.risk === 'write' || tool.risk === 'command' || tool.risk === 'destructive' || tool.risk === 'privileged'
}

function hashArgs(args: unknown): string {
  try {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 16)
  } catch {
    return 'unhashable'
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return 'File or folder not found.'
    if (code === 'EACCES' || code === 'EPERM') return 'The operating system denied access.'
    if (code === 'EISDIR') return 'That path is a directory.'
    return error.message
  }
  return String(error)
}

function normalizeChoice(choice: ApprovalChoice | boolean): ApprovalChoice {
  if (choice === true) return 'once'
  if (choice === false) return 'deny'
  return choice
}

function describeScope(scope: ToolScope): string {
  if (scope.kind === 'path') return `${scope.grantLabel}/${scope.relative}`
  if (scope.kind === 'url') return scope.host
  return 'none'
}
