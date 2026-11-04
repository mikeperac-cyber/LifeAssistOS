import type { BrowserWindow } from 'electron'
import { describe, expect, it } from 'vitest'
import { UiApprovalBroker } from '../src/main/approval'
import type { PermissionRequest } from '../src/shared/types'

function request(id: string): PermissionRequest {
  return {
    id,
    callId: `call-${id}`,
    tool: 'web_search',
    risk: 'external',
    summary: `Search ${id}`,
    preview: `Query ${id}`,
    sessionApprovalAllowed: false
  }
}

function brokerHarness(): { broker: UiApprovalBroker; events: Array<Record<string, unknown>> } {
  const events: Array<Record<string, unknown>> = []
  const window = {
    isDestroyed: () => false,
    webContents: { send: (_channel: string, event: unknown) => events.push(event as Record<string, unknown>) }
  } as unknown as BrowserWindow
  return { broker: new UiApprovalBroker(() => window), events }
}

function deliveredRequests(events: Array<Record<string, unknown>>): PermissionRequest[] {
  return events.flatMap((event) =>
    event.type === 'permission_request' && event.request && typeof event.request === 'object'
      ? [event.request as PermissionRequest]
      : [])
}

describe('UI approval broker', () => {
  it('delivers concurrent approval requests one at a time and preserves their choices', async () => {
    const { broker, events } = brokerHarness()
    const first = broker.request(request('first'), new AbortController().signal)
    const second = broker.request(request('second'), new AbortController().signal)

    expect(deliveredRequests(events).map((entry) => entry.id)).toEqual(['first'])
    broker.respond('first', 'once')
    await expect(first).resolves.toBe('once')
    expect(deliveredRequests(events).map((entry) => entry.id)).toEqual(['first', 'second'])

    broker.respond('second', 'deny')
    await expect(second).resolves.toBe('deny')
    expect(events.filter((event) => event.type === 'permission_resolved')).toHaveLength(2)
  })

  it('denies queued requests when their caller cancels before the preview is shown', async () => {
    const { broker, events } = brokerHarness()
    const first = broker.request(request('active'), new AbortController().signal)
    const queuedController = new AbortController()
    const queued = broker.request(request('queued'), queuedController.signal)

    queuedController.abort()
    await expect(queued).resolves.toBe('deny')
    expect(deliveredRequests(events).map((entry) => entry.id)).toEqual(['active'])

    broker.respond('active', 'once')
    await expect(first).resolves.toBe('once')
    expect(deliveredRequests(events).map((entry) => entry.id)).toEqual(['active'])
  })

  it('denies all active and queued requests without displaying queued previews during shutdown', async () => {
    const { broker, events } = brokerHarness()
    const first = broker.request(request('active'), new AbortController().signal)
    const second = broker.request(request('queued'), new AbortController().signal)

    broker.denyAll()

    await expect(first).resolves.toBe('deny')
    await expect(second).resolves.toBe('deny')
    expect(deliveredRequests(events).map((entry) => entry.id)).toEqual(['active'])
    expect(events.filter((event) => event.type === 'permission_resolved')).toHaveLength(1)
  })
})
