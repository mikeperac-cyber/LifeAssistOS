import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditLog } from '../src/core/audit/log'
import { FinanceStore } from '../src/core/finance'
import { Gateway, type ApprovalBroker } from '../src/core/gateway/gateway'
import { SessionApprovalStore } from '../src/core/gateway/session-approvals'
import { defaultPolicy } from '../src/core/gateway/policy'
import { GrantStore } from '../src/core/grants'
import { ToolRegistry } from '../src/core/registry'
import type { PermissionRequest, ToolCall } from '../src/shared/types'
import { createFinanceTools } from '../src/tools/finance'

let dir = ''
let root = ''
let finance: FinanceStore
let audit: AuditLog
let grants: GrantStore
let sequence = 0

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mike-assist-finance-gateway-'))
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-finance-workspace-')))
  finance = new FinanceStore(path.join(dir, 'finance.sqlite'))
  await finance.init()
  audit = new AuditLog(path.join(dir, 'audit'), 'finance-gateway-test')
  await audit.init()
  grants = new GrantStore(path.join(dir, 'grants.json'))
  await grants.init(root)
})

afterEach(async () => {
  finance.close()
  await rm(dir, { recursive: true, force: true })
  await rm(root, { recursive: true, force: true })
})

function buildGateway(approve: ApprovalBroker): Gateway {
  const registry = new ToolRegistry()
  for (const tool of createFinanceTools(finance)) registry.register(tool)
  return new Gateway({ registry, policy: defaultPolicy, audit, grants, approve })
}

function call(args: unknown): ToolCall {
  sequence += 1
  return { id: `finance-${sequence}`, name: 'record_transaction', args, summary: 'Record a local finance entry' }
}

describe('finance gateway', () => {
  it('requires approval before recording a categorized transaction', async () => {
    let preview = ''
    const gateway = buildGateway(async (request: PermissionRequest) => {
      preview = request.preview ?? ''
      return 'once'
    })

    const result = await gateway.execute(call({
      direction: 'expense',
      amount: '24.90',
      currency: 'EUR',
      category: 'dining',
      merchant: 'Cafe Example',
      note: 'Lunch'
    }))

    expect(result.ok).toBe(true)
    expect(preview).toContain('24.90 EUR')
    expect(preview).toContain('Cafe Example')
    expect(finance.report('month').totals[0].expenseMinor).toBe(2490)
    const auditText = JSON.stringify(audit.list())
    expect(auditText).not.toContain('Cafe Example')
    expect(auditText).not.toContain('Lunch')
    expect(auditText).not.toContain('24.90')
  })

  it('does not record a transaction when the user denies approval', async () => {
    const gateway = buildGateway(async () => 'deny')
    const result = await gateway.execute(call({
      direction: 'income',
      amount: '100',
      currency: 'TRY',
      category: 'freelance'
    }))

    expect(result.denied).toBe(true)
    expect(finance.report('month').totals).toEqual([])
  })

  it('never session-auto-approves a non-idempotent finance entry', async () => {
    const registry = new ToolRegistry()
    for (const tool of createFinanceTools(finance)) registry.register(tool)
    const sessionApprovals = new SessionApprovalStore()
    let approvals = 0
    const gateway = new Gateway({
      registry,
      policy: defaultPolicy,
      audit,
      grants,
      approve: async () => { approvals += 1; return 'session' },
      sessionApprovals,
      sessionId: () => 'same-chat'
    })
    const args = { direction: 'expense', amount: '5.00', currency: 'USD', category: 'dining' }

    await gateway.execute(call(args))
    await gateway.execute(call(args))

    expect(approvals).toBe(2)
    expect(finance.report('month').recent).toHaveLength(2)
    expect(audit.list().some((event) => event.type === 'approval.session_granted')).toBe(false)
  })
})
