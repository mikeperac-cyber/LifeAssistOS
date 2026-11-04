import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditLog } from '../src/core/audit/log'
import { Gateway } from '../src/core/gateway/gateway'
import { defaultPolicy } from '../src/core/gateway/policy'
import { GrantStore } from '../src/core/grants'
import { ToolRegistry } from '../src/core/registry'
import type { PermissionRequest, ToolCall } from '../src/shared/types'
import { createBrowserTools, type BrowserAutomation, type BrowserPageSnapshot } from '../src/tools/browser'

let directory = ''
let root = ''
let audit: AuditLog
let browser: FakeBrowser
let requests: PermissionRequest[]
let onApprove: ((request: PermissionRequest) => void) | undefined
let gateway: Gateway
let sequence = 0

class FakeBrowser implements BrowserAutomation {
  url: string | null = null
  opened: string[] = []
  filled: Array<{ field: string; value: string }> = []
  clicked: string[] = []

  currentUrl(): string | null { return this.url }
  currentPageIdentity(): string | null { return this.url }
  async open(url: string): Promise<{ url: string; title: string }> {
    this.url = url
    this.opened.push(url)
    return { url, title: 'Example' }
  }
  async inspect(): Promise<BrowserPageSnapshot> {
    return { url: this.url ?? '', title: 'Example', text: 'A page', links: ['Next'], buttons: ['Save'], fields: [{ label: 'Name', type: 'text' }], truncated: false }
  }
  async click(target: string): Promise<{ url: string; title: string; message: string }> {
    this.clicked.push(target)
    return { url: this.url ?? '', title: 'Example', message: 'Clicked.' }
  }
  async fill(field: string, value: string): Promise<{ url: string; title: string; message: string }> {
    this.filled.push({ field, value })
    return { url: this.url ?? '', title: 'Example', message: 'Filled.' }
  }
}

function call(name: string, args: unknown): ToolCall {
  sequence += 1
  return { id: `browser-test-${sequence}`, name, args }
}

beforeEach(async () => {
  sequence = 0
  directory = await mkdtemp(path.join(tmpdir(), 'mike-assist-browser-tools-'))
  root = path.join(directory, 'workspace')
  await mkdir(root)
  const grants = new GrantStore(path.join(directory, 'grants.json'))
  await grants.init(root)
  audit = new AuditLog(path.join(directory, 'audit'), 'browser-tools-test')
  await audit.init()
  browser = new FakeBrowser()
  requests = []
  onApprove = undefined
  const registry = new ToolRegistry()
  for (const tool of createBrowserTools(browser, (host) => host === 'example.com')) registry.register(tool)
  gateway = new Gateway({
    registry,
    policy: defaultPolicy,
    audit,
    grants,
    approve: async (request) => {
      requests.push(request)
      onApprove?.(request)
      return 'once'
    },
    externalHostAllowed: (host) => host === 'example.com'
  })
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('browser tools', () => {
  it('opens only an exact allowlisted HTTPS domain and never saves session approval', async () => {
    const denied = await gateway.execute(call('browser_open_url', { url: 'https://other.com/' }))
    expect(denied.blocked).toBe(true)
    expect(requests).toHaveLength(0)

    const opened = await gateway.execute(call('browser_open_url', { url: 'https://example.com/' }))
    expect(opened.ok).toBe(true)
    expect(browser.opened).toEqual(['https://example.com/'])
    expect(requests[0].sessionApprovalAllowed).toBe(false)
    expect(requests[0].preview).toContain('https://example.com/')
  })

  it('requires a one-time approval before sending page inspection to the model', async () => {
    browser.url = 'https://example.com/home'
    const result = await gateway.execute(call('browser_inspect', {}))

    expect(result.ok).toBe(true)
    expect((result.output as BrowserPageSnapshot).text).toBe('A page')
    expect(requests).toHaveLength(1)
    expect(requests[0].sessionApprovalAllowed).toBe(false)
    expect(requests[0].preview).toContain('send its visible text')
  })

  it('shows the exact fill value for approval but does not store it in the audit trail', async () => {
    browser.url = 'https://example.com/profile'
    const privateValue = 'mike.private@example.com'
    const result = await gateway.execute(call('browser_fill', { field: 'Email address', value: privateValue }))

    expect(result.ok).toBe(true)
    expect(browser.filled).toEqual([{ field: 'Email address', value: privateValue }])
    expect(requests[0].preview).toContain(privateValue)
    expect(requests[0].sessionApprovalAllowed).toBe(false)
    expect(audit.exportJsonl()).not.toContain(privateValue)
  })

  it('stops an approved action if the page leaves the approved host before execution', async () => {
    browser.url = 'https://example.com/home'
    onApprove = () => { browser.url = 'https://other.com/home' }

    const result = await gateway.execute(call('browser_click', { target: 'Continue' }))

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/allowlist/i)
    expect(browser.clicked).toHaveLength(0)
  })

  it('stops an approved action if the page changes on the same host', async () => {
    browser.url = 'https://example.com/home'
    onApprove = () => { browser.url = 'https://example.com/checkout' }

    const result = await gateway.execute(call('browser_click', { target: 'Continue' }))

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/page changed after approval/i)
    expect(browser.clicked).toHaveLength(0)
  })
})
