import { isIP } from 'node:net'

import type { Request } from 'express'

import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'

import type { EnvService } from '../../env/env.service'

/** Trust only a valid internal claim from an allowlisted actual socket peer. */
export function resolveVerifiedVisitorIp(req: Request, env: EnvService): string | undefined {
  const trustedPeers = env.get('TRUSTED_WEB_PEERS')
  const peer = req.socket?.remoteAddress
  const peerVersion = peer ? isIP(peer) : 0

  if (trustedPeers && peerVersion !== 0) {
    const peerTrusted = trustedPeers.check(peer!, peerVersion === 4 ? 'ipv4' : 'ipv6')
    if (peerTrusted) {
      const candidate = req.headers[AMCORE_CLIENT_IP_HEADER]
      if (typeof candidate === 'string' && isIP(candidate) !== 0) {
        return candidate
      }
    }
  }

  return undefined
}

/** Session metadata only; never rewrites req.ip or security consumer inputs. */
export function resolveSessionIpAddress(req: Request, env: EnvService): string | undefined {
  return resolveVerifiedVisitorIp(req, env) ?? req.ip ?? req.socket?.remoteAddress
}
