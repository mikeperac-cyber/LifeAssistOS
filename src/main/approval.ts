import type { BrowserWindow } from 'electron'
import type { ApprovalBroker } from '../core/gateway/gateway'
import type { ApprovalChoice, PermissionRequest } from '../shared/types'

interface PendingApproval {
  settle: (choice: ApprovalChoice, expired?: boolean) => void
  delivered: boolean
  request: PermissionRequest
}

/**
 * Bridges the gateway's approval request to the renderer. A closed window or
 * an aborted signal always resolves to deny.
 */
export class UiApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>()
  private readonly queue: string[] = []
  private activeRequestId: string | null = null
  private suspendingDelivery = false

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  request: ApprovalBroker = (request: PermissionRequest, signal: AbortSignal) => {
    const window = this.getWindow()
    if (!window || window.isDestroyed() || signal.aborted) {
      return Promise.resolve('deny')
    }

    return new Promise<ApprovalChoice>((resolve) => {
      const settle = (choice: ApprovalChoice, expired = false): void => {
        const entry = this.pending.get(request.id)
        if (!entry) return
        this.pending.delete(request.id)
        const queueIndex = this.queue.indexOf(request.id)
        if (queueIndex >= 0) this.queue.splice(queueIndex, 1)
        if (this.activeRequestId === request.id) this.activeRequestId = null
        signal.removeEventListener('abort', onAbort)

        const current = this.getWindow()
        if (entry.delivered && current && !current.isDestroyed()) {
          try {
            current.webContents.send('assist:event', {
              type: 'permission_resolved',
              requestId: request.id,
              approved: choice !== 'deny',
              expired
            })
          } catch {
            // A closing renderer cannot keep an approval promise pending.
          }
        }

        resolve(choice)
        if (!this.suspendingDelivery) this.deliverNext()
      }

      const onAbort = (): void => settle('deny', true)

      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(request.id, { settle, delivered: false, request })
      this.queue.push(request.id)
      if (signal.aborted) settle('deny', true)
      else this.deliverNext()
    })
  }

  respond(requestId: string, choice: ApprovalChoice): void {
    this.pending.get(requestId)?.settle(choice)
  }

  denyAll(): void {
    this.suspendingDelivery = true
    try {
      for (const requestId of [...this.pending.keys()]) {
        this.pending.get(requestId)?.settle('deny')
      }
      this.queue.length = 0
      this.activeRequestId = null
    } finally {
      this.suspendingDelivery = false
    }
  }

  private deliverNext(): void {
    if (this.activeRequestId || this.suspendingDelivery) return

    while (this.queue.length > 0) {
      const requestId = this.queue.shift()
      if (!requestId) continue
      const pending = this.pending.get(requestId)
      if (!pending) continue

      const window = this.getWindow()
      if (!window || window.isDestroyed()) {
        this.denyAll()
        return
      }

      this.activeRequestId = requestId
      pending.delivered = true
      try {
        window.webContents.send('assist:event', {
          type: 'permission_request',
          request: pending.request
        })
      } catch {
        this.activeRequestId = null
        pending.settle('deny', true)
      }
      return
    }
  }
}
