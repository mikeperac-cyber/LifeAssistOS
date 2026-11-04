import { createHash } from 'node:crypto'
import type { Risk, ToolScope } from '../../shared/types'

/** A process-local cache of exact approvals, deliberately not persisted. */
export class SessionApprovalStore {
  private readonly approvals = new Map<string, Set<string>>()

  has(sessionId: string, fingerprint: string): boolean {
    return this.approvals.get(sessionId)?.has(fingerprint) ?? false
  }

  remember(sessionId: string, fingerprint: string): void {
    const existing = this.approvals.get(sessionId) ?? new Set<string>()
    existing.add(fingerprint)
    this.approvals.set(sessionId, existing)
  }

  clear(sessionId: string): void {
    this.approvals.delete(sessionId)
  }
}

export function approvalFingerprint(input: {
  tool: string
  risk: Risk
  scope: ToolScope
  args: unknown
}): string {
  const canonical = JSON.stringify({
    tool: input.tool,
    risk: input.risk,
    scope: input.scope,
    args: input.args
  })
  return createHash('sha256').update(canonical).digest('hex')
}
