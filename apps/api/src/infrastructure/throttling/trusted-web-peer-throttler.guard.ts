import { isIP } from 'node:net'

import { Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler'
import type { Request } from 'express'

import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'

import { EnvService } from '../../env/env.service'

/**
 * Global throttler tracker (extends ADR-039's Redis storage). Trusts the
 * BFF-relayed `AMCORE_CLIENT_IP_HEADER` (ADR-072) only when the inbound
 * request's *actual* socket peer — `req.socket.remoteAddress`, never a
 * forwarded header, and independent of Express's own `TRUST_PROXY`
 * machinery — is in the configured `TRUSTED_WEB_PEERS` set. Falls back to
 * the stock `req.ip` tracker otherwise:
 *
 * - `TRUSTED_WEB_PEERS` unset (default) → identical to the stock
 *   `ThrottlerGuard`, no behavior change until an operator opts in.
 * - A request whose peer isn't in the trusted set can never spoof its way
 *   into a distinct bucket via the header, no matter what value it sends —
 *   the header is only ever read after the peer check passes.
 * - A missing, malformed, or duplicated (comma-joined) header value is
 *   ignored, never throws — falls back to `req.ip` for that request.
 */
@Injectable()
export class TrustedWebPeerThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly env: EnvService
  ) {
    super(options, storageService, reflector)
  }

  protected async getTracker(req: Request): Promise<string> {
    const trustedPeers = this.env.get('TRUSTED_WEB_PEERS')
    const peer = req.socket.remoteAddress
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

    // Express 5 types req.ip as possibly undefined (a destroyed/edge-case
    // socket); the stock ThrottlerGuard sidesteps this by typing req loosely
    // as Record<string, any>. Falling back through socket.remoteAddress
    // mirrors getClientIp()'s own fallback chain (common/utils/anonymize-ip.ts).
    return req.ip ?? req.socket.remoteAddress ?? 'unknown'
  }
}
