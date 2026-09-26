import type { Request } from 'express'

import { resolveVerifiedVisitorIp } from '../../common/utils/verified-visitor-ip'
import type { EnvService } from '../../env/env.service'

/** Existing global tracker semantics, including the unknown-address sentinel. */
export function resolveTracker(req: Request, env: EnvService): string {
  return resolveVerifiedVisitorIp(req, env) ?? req.ip ?? req.socket.remoteAddress ?? 'unknown'
}
