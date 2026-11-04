import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AuditLog } from '../src/core/audit/log'
import { Gateway } from '../src/core/gateway/gateway'
import { defaultPolicy } from '../src/core/gateway/policy'
import { GrantStore } from '../src/core/grants'
import { ToolRegistry } from '../src/core/registry'
import type { PermissionRequest, ToolCall } from '../src/shared/types'
import { runCommandTool, type RunCommandResult } from '../src/tools/terminal'

function nodeCommand(code: string): string {
  const quotedExecutable = process.platform === 'win32'
    ? `"${process.execPath}"`
    : `'${process.execPath.replaceAll("'", "'\\''")}'`
  const quotedCode = process.platform === 'win32' ? `"${code}"` : `'${code.replaceAll("'", "'\\''")}'`
  return `${quotedExecutable} -e ${quotedCode}`
}

describe('approved command tool', () => {
  it('runs in the approved folder and requires a typed one-time RUN approval', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-command-')))
    const auditDir = await mkdtemp(path.join(tmpdir(), 'mike-assist-command-audit-'))
    const audit = new AuditLog(auditDir, 'terminal-test')
    await audit.init()
    const grants = new GrantStore(path.join(auditDir, 'grants.json'))
    await grants.init(root)
    const registry = new ToolRegistry().register(runCommandTool)
    const approvals: PermissionRequest[] = []
    const gateway = new Gateway({
      registry,
      policy: defaultPolicy,
      audit,
      grants,
      approve: async (request) => { approvals.push(request); return 'once' }
    })

    try {
      const call: ToolCall = {
        id: 'command-approved',
        name: 'run_command',
        args: { command: nodeCommand('process.stdout.write(process.cwd())') },
        summary: 'Check the project working directory'
      }
      const result = await gateway.execute(call)

      expect(result.ok).toBe(true)
      expect(result.output as RunCommandResult).toEqual(expect.objectContaining({ stdout: root, exitCode: 0 }))
      expect(approvals).toHaveLength(1)
      expect(approvals[0]).toMatchObject({
        tool: 'run_command',
        risk: 'command',
        confirm: { verb: 'run', expects: 'RUN' },
        sessionApprovalAllowed: false
      })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(auditDir, { recursive: true, force: true })
    }
  })

  it('does not execute after the user denies the command', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-command-deny-')))
    const auditDir = await mkdtemp(path.join(tmpdir(), 'mike-assist-command-deny-audit-'))
    const audit = new AuditLog(auditDir, 'terminal-deny-test')
    await audit.init()
    const grants = new GrantStore(path.join(auditDir, 'grants.json'))
    await grants.init(root)
    const gateway = new Gateway({
      registry: new ToolRegistry().register(runCommandTool),
      policy: defaultPolicy,
      audit,
      grants,
      approve: async () => 'deny'
    })

    try {
      const command = process.platform === 'win32' ? 'echo ran > denied.txt' : 'printf ran > denied.txt'
      const result = await gateway.execute({
        id: 'command-denied',
        name: 'run_command',
        args: { command }
      })
      expect(result.denied).toBe(true)
      await expect(readFile(path.join(root, 'denied.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(auditDir, { recursive: true, force: true })
    }
  })

  it('blocks execution from a read-only folder before asking for approval', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-command-readonly-')))
    const readOnly = path.join(root, 'readonly')
    await mkdir(readOnly)
    const auditDir = await mkdtemp(path.join(tmpdir(), 'mike-assist-command-readonly-audit-'))
    const audit = new AuditLog(auditDir, 'terminal-readonly-test')
    await audit.init()
    const grants = new GrantStore(path.join(auditDir, 'grants.json'))
    await grants.init(root)
    await grants.add({ folderPath: readOnly, access: 'read' })
    let approvalCount = 0
    const gateway = new Gateway({
      registry: new ToolRegistry().register(runCommandTool),
      policy: defaultPolicy,
      audit,
      grants,
      approve: async () => { approvalCount += 1; return 'once' }
    })

    try {
      const result = await gateway.execute({
        id: 'command-readonly',
        name: 'run_command',
        args: { root: 'readonly', command: 'echo should-not-run' }
      })
      expect(result.blocked).toBe(true)
      expect(result.error).toContain('read-only')
      expect(approvalCount).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(auditDir, { recursive: true, force: true })
    }
  })

  it('does not pass common credential and code-injection environment variables to the command', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-command-env-')))
    const names = [
      'MIKE_ASSIST_API_KEY',
      'AWS_ACCESS_KEY_ID',
      'DATABASE_URL',
      'NODE_OPTIONS',
      'MIKE_ASSIST_PROXY_URL'
    ]
    const previous = new Map(names.map((name) => [name, process.env[name]]))
    process.env.MIKE_ASSIST_API_KEY = 'test-secret-value'
    process.env.AWS_ACCESS_KEY_ID = 'test-aws-access-key'
    process.env.DATABASE_URL = 'postgres://test-user:test-password@localhost/example'
    process.env.NODE_OPTIONS = '--require ./unexpected.js'
    process.env.MIKE_ASSIST_PROXY_URL = 'https://api.example.test/?access_token=test-proxy-token'
    try {
      const result = await runCommandTool.run(
        { command: nodeCommand("process.stdout.write(['MIKE_ASSIST_API_KEY','AWS_ACCESS_KEY_ID','DATABASE_URL','NODE_OPTIONS','MIKE_ASSIST_PROXY_URL'].map(k=>process.env[k]||'absent').join('|'))") },
        {
          kind: 'path',
          path: root,
          grant: { id: 'grant', label: 'Test', root, access: 'read-write', createdAt: new Date().toISOString() },
          relative: '.',
          signal: new AbortController().signal
        }
      )
      expect(result).toMatchObject({ stdout: 'absent|absent|absent|absent|absent', exitCode: 0 })
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  it('redacts inherited secret values if a command prints them', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mike-assist-command-redact-')))
    const oldValue = process.env.MIKE_ASSIST_API_KEY
    process.env.MIKE_ASSIST_API_KEY = 'test-secret-value-123'
    try {
      const result = await runCommandTool.run(
        { command: nodeCommand("process.stdout.write('credential=test-secret-value-123')") },
        {
          kind: 'path',
          path: root,
          grant: { id: 'grant', label: 'Test', root, access: 'read-write', createdAt: new Date().toISOString() },
          relative: '.',
          signal: new AbortController().signal
        }
      )
      expect(result.stdout).toBe('credential=[REDACTED]')
    } finally {
      if (oldValue === undefined) delete process.env.MIKE_ASSIST_API_KEY
      else process.env.MIKE_ASSIST_API_KEY = oldValue
      await rm(root, { recursive: true, force: true })
    }
  })
})
