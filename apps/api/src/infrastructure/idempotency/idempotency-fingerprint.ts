import { createHash } from 'node:crypto'

import type { Request } from 'express'

import { normalizeRouteTemplate } from '@/infrastructure/observability/route-template'

export function createIdempotencyFingerprint(req: Request & { rawBody?: Buffer }): string {
  const route = normalizeRouteTemplate(req)
  const rawBody = req.rawBody ?? Buffer.alloc(0)
  const prefix = `${req.method.toUpperCase()}:${route}:`
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(prefix), rawBody]))
    .digest('hex')
}
