import { BlockList } from 'node:net'

import type { Request } from 'express'

import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'

import { resolveTracker } from './client-tracker'

import type { EnvService } from '@/env/env.service'

function makeEnv(trustedWebPeers: BlockList | null): EnvService {
  return { get: jest.fn().mockReturnValue(trustedWebPeers) } as unknown as EnvService
}

describe('resolveTracker', () => {
  it('falls back to req.ip when TRUSTED_WEB_PEERS is disabled (default) — identical to the stock guard', () => {
    const env = makeEnv(null)
    const req = {
      ip: '203.0.113.7',
      socket: { remoteAddress: '172.20.0.5' } as never,
      headers: { [AMCORE_CLIENT_IP_HEADER]: '9.9.9.9' },
    }

    expect(resolveTracker(req as unknown as Request, env)).toBe('203.0.113.7')
  })

  it('falls back to req.ip when the socket peer is not in the trusted set', () => {
    const trustedPeers = new BlockList()
    trustedPeers.addSubnet('172.20.0.0', 16, 'ipv4')
    const env = makeEnv(trustedPeers)
    const req = {
      ip: '203.0.113.7',
      socket: { remoteAddress: '8.8.8.8' } as never, // not in 172.20.0.0/16
      headers: { [AMCORE_CLIENT_IP_HEADER]: '9.9.9.9' },
    }

    expect(resolveTracker(req as unknown as Request, env)).toBe('203.0.113.7')
  })

  it('trusts the relayed client-IP header when the socket peer IS in the trusted set', () => {
    const trustedPeers = new BlockList()
    trustedPeers.addSubnet('172.20.0.0', 16, 'ipv4')
    const env = makeEnv(trustedPeers)
    const req = {
      ip: '203.0.113.7', // the web container's own address — must NOT be used
      socket: { remoteAddress: '172.20.0.5' } as never,
      headers: { [AMCORE_CLIENT_IP_HEADER]: '9.9.9.9' },
    }

    expect(resolveTracker(req as unknown as Request, env)).toBe('9.9.9.9')
  })

  it('ignores a malformed (non-IP) relayed header even from a trusted peer', () => {
    const trustedPeers = new BlockList()
    trustedPeers.addSubnet('172.20.0.0', 16, 'ipv4')
    const env = makeEnv(trustedPeers)
    const req = {
      ip: '203.0.113.7',
      socket: { remoteAddress: '172.20.0.5' } as never,
      headers: { [AMCORE_CLIENT_IP_HEADER]: 'not-an-ip' },
    }

    expect(resolveTracker(req as unknown as Request, env)).toBe('203.0.113.7')
  })

  it('ignores a duplicated/comma-joined relayed header even from a trusted peer', () => {
    const trustedPeers = new BlockList()
    trustedPeers.addSubnet('172.20.0.0', 16, 'ipv4')
    const env = makeEnv(trustedPeers)
    const req = {
      ip: '203.0.113.7',
      socket: { remoteAddress: '172.20.0.5' } as never,
      headers: { [AMCORE_CLIENT_IP_HEADER]: '9.9.9.9, 1.2.3.4' },
    }

    expect(resolveTracker(req as unknown as Request, env)).toBe('203.0.113.7')
  })

  it('ignores a missing relayed header even from a trusted peer', () => {
    const trustedPeers = new BlockList()
    trustedPeers.addSubnet('172.20.0.0', 16, 'ipv4')
    const env = makeEnv(trustedPeers)
    const req = {
      ip: '203.0.113.7',
      socket: { remoteAddress: '172.20.0.5' } as never,
      headers: {},
    }

    expect(resolveTracker(req as unknown as Request, env)).toBe('203.0.113.7')
  })

  it('falls back to socket.remoteAddress when req.ip is undefined (edge case)', () => {
    const env = makeEnv(null)
    const req = {
      ip: undefined,
      socket: { remoteAddress: '198.51.100.9' } as never,
      headers: {},
    }

    expect(resolveTracker(req as unknown as Request, env)).toBe('198.51.100.9')
  })
})
