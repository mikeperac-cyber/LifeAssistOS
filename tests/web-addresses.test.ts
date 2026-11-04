import { describe, expect, it } from 'vitest'
import { isPublicAddress } from '../src/tools/web'

describe('public address checks', () => {
  it('allows ordinary public IPv4 and IPv6 addresses', () => {
    expect(isPublicAddress('1.1.1.1')).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
  })

  it('blocks private, local, documentation, and reserved IPv4 ranges', () => {
    for (const address of [
      '10.1.2.3',
      '127.0.0.1',
      '169.254.10.2',
      '172.20.1.1',
      '192.0.0.1',
      '192.0.2.7',
      '192.31.196.1',
      '192.52.193.1',
      '192.88.99.1',
      '192.168.1.1',
      '192.175.48.1',
      '198.18.0.1',
      '198.51.100.9',
      '203.0.113.4',
      '224.0.0.1',
      '240.0.0.1'
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  it('blocks IPv6 local, mapped-private, documentation, and protocol ranges', () => {
    for (const address of [
      '::',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fe80::1',
      'ff02::1',
      '2001:20::1',
      '2001:db8::1',
      '2002::1',
      '3fff::1'
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
    expect(isPublicAddress('::ffff:1.1.1.1')).toBe(true)
  })
})
