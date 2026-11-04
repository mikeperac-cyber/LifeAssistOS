import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { normalizeDomain } from '../core/domain-allowlist'
import { isPublicAddress } from '../tools/web'

type ResolveHost = (host: string) => Promise<LookupAddress[]>
type ConnectPinned = (address: string, port: number, family: 4 | 6) => Socket

const TUNNEL_PORT = 443
const CONNECT_TIMEOUT_MS = 12_000
const MAX_AUTHORITY_CHARS = 260

/**
 * A loopback HTTP CONNECT proxy for the isolated browser session. It resolves
 * each destination itself, rejects private/reserved answers, and connects to a
 * selected numeric IP so Chromium cannot perform a second, rebinding lookup.
 * TLS stays end-to-end between Chromium and the website.
 */
export class PinnedHttpsProxy {
  private server: Server | null = null
  private started: Promise<number> | null = null
  private readonly clientSockets = new Set<Duplex>()
  private closing = false

  constructor(
    private readonly allowsHost: (host: string) => boolean,
    private readonly resolveHost: ResolveHost = (host) => lookup(host, { all: true, verbatim: true }),
    private readonly connectPinned: ConnectPinned = (address, port, family) => connect({ host: address, port, family })
  ) {}

  start(): Promise<number> {
    if (this.started) return this.started
    if (this.closing) return Promise.reject(new Error('The browser network proxy is closing.'))

    const server = createServer((_request, response) => {
      response.writeHead(403, { connection: 'close' })
      response.end()
    })
    this.server = server
    server.on('connection', (socket) => {
      this.clientSockets.add(socket)
      socket.once('close', () => this.clientSockets.delete(socket))
    })
    server.on('connect', (request, client, head) => {
      void this.handleConnect(request, client, head).catch(() => rejectTunnel(client, 502, 'Bad Gateway'))
    })

    this.started = new Promise<number>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        this.started = null
        this.server = null
        reject(error)
      }
      const onListening = (): void => {
        server.off('error', onError)
        const address = server.address()
        if (!address || typeof address === 'string') {
          this.started = null
          this.server = null
          reject(new Error('The browser proxy did not bind to a TCP port.'))
          return
        }
        resolve((address as AddressInfo).port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, '127.0.0.1')
    })
    return this.started
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    const startInProgress = this.started
    if (startInProgress) await startInProgress.catch(() => undefined)
    for (const socket of this.clientSockets) socket.destroy()
    this.clientSockets.clear()
    const server = this.server
    this.server = null
    this.started = null
    if (!server?.listening) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handleConnect(request: IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
    const authority = request.url ?? ''
    const target = parseConnectAuthority(authority)
    if (!target || target.port !== TUNNEL_PORT || request.headers.host?.toLowerCase() !== authority.toLowerCase()) {
      rejectTunnel(client, 403, 'Forbidden')
      return
    }

    const host = normalizeDomain(target.host)
    if (!host || !this.allowsHost(host)) {
      rejectTunnel(client, 403, 'Forbidden')
      return
    }

    let addresses: LookupAddress[]
    try {
      addresses = await this.resolveHost(host)
    } catch {
      rejectTunnel(client, 502, 'Bad Gateway')
      return
    }
    if (
      client.destroyed ||
      addresses.length === 0 ||
      addresses.some((entry) => !isPublicAddress(entry.address) || (entry.family !== 4 && entry.family !== 6))
    ) {
      rejectTunnel(client, 403, 'Forbidden')
      return
    }

    // Pin to one validated result. No host name is passed to net.connect.
    const address = addresses[0]
    const upstream = this.connectPinned(address.address, target.port, address.family as 4 | 6)
    const timeout = setTimeout(() => upstream.destroy(new Error('Upstream connection timed out.')), CONNECT_TIMEOUT_MS)
    let connected = false
    client.once('close', () => upstream.destroy())
    client.once('error', () => upstream.destroy())
    upstream.once('connect', () => {
      connected = true
      clearTimeout(timeout)
      if (client.destroyed) {
        upstream.destroy()
        return
      }
      client.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Mike Assist\r\n\r\n')
      if (head.length > 0) upstream.write(head)
      client.pipe(upstream)
      upstream.pipe(client)
    })
    upstream.once('error', () => {
      clearTimeout(timeout)
      if (!connected) rejectTunnel(client, 502, 'Bad Gateway')
      else client.destroy()
    })
    upstream.once('close', () => {
      clearTimeout(timeout)
      if (!client.destroyed) client.end()
    })
  }
}

interface ConnectTarget {
  host: string
  port: number
}

function parseConnectAuthority(authority: string): ConnectTarget | null {
  if (!authority || authority.length > MAX_AUTHORITY_CHARS) return null
  const match = /^(?:([^:\[\]]+)|\[([^\]]+)\]):(\d{1,5})$/.exec(authority)
  if (!match) return null
  const port = Number(match[3])
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null
  return { host: match[1] ?? match[2], port }
}

function rejectTunnel(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed) return
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}
