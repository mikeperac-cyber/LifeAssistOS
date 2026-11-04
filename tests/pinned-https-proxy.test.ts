import { request as httpRequest } from 'node:http'
import type { LookupAddress } from 'node:dns'
import { createServer, connect as netConnect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { PinnedHttpsProxy } from '../src/main/pinned-https-proxy'

const proxies: PinnedHttpsProxy[] = []
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

function openProxy(
  allowsHost: (host: string) => boolean,
  resolveHost: (host: string) => Promise<LookupAddress[]>,
  connectPinned?: (address: string, port: number, family: 4 | 6) => ReturnType<typeof netConnect>
): PinnedHttpsProxy {
  const proxy = new PinnedHttpsProxy(allowsHost, resolveHost, connectPinned)
  proxies.push(proxy)
  return proxy
}

function connectThroughProxy(proxyPort: number, authority: string): Promise<{
  status: number
  socket: import('node:net').Socket
  head: Buffer
}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: authority,
      headers: { host: authority }
    })
    request.once('connect', (response, socket, head) => {
      resolve({ status: response.statusCode ?? 0, socket, head })
    })
    request.once('error', reject)
    request.end()
  })
}

describe('PinnedHttpsProxy', () => {
  it('pins an approved public HTTPS tunnel to the validated numeric address', async () => {
    const upstream = createServer((socket) => socket.on('data', (chunk) => socket.write(chunk)))
    servers.push(upstream)
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const upstreamPort = (upstream.address() as import('node:net').AddressInfo).port
    const pinnedTargets: Array<{ address: string; port: number; family: number }> = []
    const proxy = openProxy(
      (host) => host === 'example.com',
      async () => [{ address: '1.1.1.1', family: 4 }],
      (address, port, family) => {
        pinnedTargets.push({ address, port, family })
        // Route the test tunnel into a local echo server while retaining and
        // checking the public numeric address selected by the proxy.
        return netConnect({ host: '127.0.0.1', port: upstreamPort })
      }
    )
    const proxyPort = await proxy.start()
    const tunnel = await connectThroughProxy(proxyPort, 'example.com:443')
    expect(tunnel.status).toBe(200)
    expect(pinnedTargets).toEqual([{ address: '1.1.1.1', port: 443, family: 4 }])

    const echoed = new Promise<string>((resolve, reject) => {
      tunnel.socket.once('data', (data) => resolve(data.toString()))
      tunnel.socket.once('error', reject)
    })
    tunnel.socket.write('tls-bytes')
    await expect(echoed).resolves.toBe('tls-bytes')
    tunnel.socket.destroy()
  })

  it('rejects a hostname resolving to private addresses before opening a tunnel', async () => {
    let connected = false
    const proxy = openProxy(
      (host) => host === 'private.service.org',
      async () => [{ address: '10.20.30.40', family: 4 }],
      () => {
        connected = true
        return netConnect({ host: '127.0.0.1', port: 9 })
      }
    )
    const tunnel = await connectThroughProxy(await proxy.start(), 'private.service.org:443')
    expect(tunnel.status).toBe(403)
    expect(connected).toBe(false)
    tunnel.socket.destroy()
  })

  it('rejects unapproved hosts and non-443 CONNECT requests', async () => {
    let resolutions = 0
    const proxy = openProxy(
      () => false,
      async () => {
        resolutions += 1
        return [{ address: '1.1.1.1', family: 4 }]
      }
    )
    const port = await proxy.start()
    const unapproved = await connectThroughProxy(port, 'other.example.net:443')
    const wrongPort = await connectThroughProxy(port, 'other.example.net:8443')
    expect(unapproved.status).toBe(403)
    expect(wrongPort.status).toBe(403)
    expect(resolutions).toBe(0)
    unapproved.socket.destroy()
    wrongPort.socket.destroy()
  })

  it('closes cleanly when shutdown races with proxy startup', async () => {
    const proxy = openProxy(() => false, async () => [])
    const portPromise = proxy.start()
    await proxy.close()
    const port = await portPromise
    await expect(connectThroughProxy(port, 'example.com:443')).rejects.toBeDefined()
  })
})
