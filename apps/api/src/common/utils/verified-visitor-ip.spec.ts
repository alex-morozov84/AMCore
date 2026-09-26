import type { Request } from 'express'

import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'

import type { EnvService } from '../../env/env.service'

import { resolveTrustedWebPeers } from './trusted-web-peer'
import { resolveSessionIpAddress } from './verified-visitor-ip'

it.each([
  ['172.20.0.5', '8.8.8.8', '172.20.0.5', '8.8.8.8'],
  ['172.20.0.5', '2001:4860:4860::8888', '172.20.0.5', '2001:4860:4860::8888'],
  ['::ffff:172.20.0.5', '8.8.8.8', '172.20.0.5', '8.8.8.8'],
  ['172.20.0.6', '8.8.8.8', '172.20.0.5', 'fallback'],
  ['172.20.0.5', '8.8.8.8', '', 'fallback'],
  ['172.20.0.5', ['8.8.8.8', '1.1.1.1'], '172.20.0.5', 'fallback'],
  ['172.20.0.5', '8.8.8.8, 1.1.1.1', '172.20.0.5', 'fallback'],
  ['172.20.0.5', 'garbage', '172.20.0.5', 'fallback'],
  ['172.20.0.5', undefined, '172.20.0.5', 'fallback'],
])('Session address validates peer %s and claim %s', (peer, claim, allowlist, expected) => {
  const req = {
    ip: 'fallback',
    socket: { remoteAddress: peer },
    headers: { [AMCORE_CLIENT_IP_HEADER]: claim },
  } as unknown as Request
  const env = { get: () => resolveTrustedWebPeers(allowlist as string) } as unknown as EnvService
  expect(resolveSessionIpAddress(req, env)).toBe(expected)
})

it('absent req.ip falls back to actual peer, without inventing a visitor', () => {
  const env = { get: () => null } as unknown as EnvService
  expect(
    resolveSessionIpAddress({ headers: {}, socket: { remoteAddress: '127.0.0.1' } } as Request, env)
  ).toBe('127.0.0.1')
  expect(resolveSessionIpAddress({ headers: {}, socket: {} } as Request, env)).toBeUndefined()
})
