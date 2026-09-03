import { BlockList } from 'node:net'

import { Reflector } from '@nestjs/core'
import type { Request } from 'express'

import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'

import { TrustedWebPeerThrottlerGuard } from './trusted-web-peer-throttler.guard'

function makeGuard(trustedWebPeers: BlockList | null) {
  const env = { get: jest.fn().mockReturnValue(trustedWebPeers) }
  const guard = new TrustedWebPeerThrottlerGuard(
    { throttlers: [] } as never,
    {} as never,
    {} as unknown as Reflector,
    env as never
  )
  return guard
}

function getTracker(guard: TrustedWebPeerThrottlerGuard, req: Partial<Request>): Promise<string> {
  return (guard as unknown as { getTracker(req: Request): Promise<string> }).getTracker(
    req as Request
  )
}

describe('TrustedWebPeerThrottlerGuard', () => {
  it('falls back to req.ip when TRUSTED_WEB_PEERS is disabled (default) — identical to the stock guard', async () => {
    const guard = makeGuard(null)
    const req = {
      ip: '203.0.113.7',
      socket: { remoteAddress: '172.20.0.5' } as never,
      headers: { [AMCORE_CLIENT_IP_HEADER]: '9.9.9.9' },
    }

    await expect(getTracker(guard, req)).resolves.toBe('203.0.113.7')
  })

  it('falls back to req.ip when the socket peer is not in the trusted set', async () => {
    const trustedPeers = new BlockList()
    trustedPeers.addSubnet('172.20.0.0', 16, 'ipv4')
    const guard = makeGuard(trustedPeers)
    const req = {
      ip: '203.0.113.7',
      socket: { remoteAddress: '8.8.8.8' } as never, // not in 172.20.0.0/16
      headers: { [AMCORE_CLIENT_IP_HEADER]: '9.9.9.9' },
    }

    await expect(getTracker(guard, req)).resolves.toBe('203.0.113.7')
  })

  it('trusts the relayed client-IP header when the socket peer IS in the trusted set', async () => {
    const trustedPeers = new BlockList()
    trustedPeers.addSubnet('172.20.0.0', 16, 'ipv4')
    const guard = makeGuard(trustedPeers)
    const req = {
      ip: '203.0.113.7', // the web container's own address — must NOT be used
      socket: { remoteAddress: '172.20.0.5' } as never,
      headers: { [AMCORE_CLIENT_IP_HEADER]: '9.9.9.9' },
    }

    await expect(getTracker(guard, req)).resolves.toBe('9.9.9.9')
  })

  it('ignores a malformed (non-IP) relayed header even from a trusted peer', async () => {
    const trustedPeers = new BlockList()
    trustedPeers.addSubnet('172.20.0.0', 16, 'ipv4')
    const guard = makeGuard(trustedPeers)
    const req = {
      ip: '203.0.113.7',
      socket: { remoteAddress: '172.20.0.5' } as never,
      headers: { [AMCORE_CLIENT_IP_HEADER]: 'not-an-ip' },
    }

    await expect(getTracker(guard, req)).resolves.toBe('203.0.113.7')
  })

  it('ignores a duplicated/comma-joined relayed header even from a trusted peer', async () => {
    const trustedPeers = new BlockList()
    trustedPeers.addSubnet('172.20.0.0', 16, 'ipv4')
    const guard = makeGuard(trustedPeers)
    const req = {
      ip: '203.0.113.7',
      socket: { remoteAddress: '172.20.0.5' } as never,
      headers: { [AMCORE_CLIENT_IP_HEADER]: '9.9.9.9, 1.2.3.4' },
    }

    await expect(getTracker(guard, req)).resolves.toBe('203.0.113.7')
  })

  it('ignores a missing relayed header even from a trusted peer', async () => {
    const trustedPeers = new BlockList()
    trustedPeers.addSubnet('172.20.0.0', 16, 'ipv4')
    const guard = makeGuard(trustedPeers)
    const req = {
      ip: '203.0.113.7',
      socket: { remoteAddress: '172.20.0.5' } as never,
      headers: {},
    }

    await expect(getTracker(guard, req)).resolves.toBe('203.0.113.7')
  })

  it('falls back to socket.remoteAddress when req.ip is undefined (edge case)', async () => {
    const guard = makeGuard(null)
    const req = {
      ip: undefined,
      socket: { remoteAddress: '198.51.100.9' } as never,
      headers: {},
    }

    await expect(getTracker(guard, req)).resolves.toBe('198.51.100.9')
  })
})
