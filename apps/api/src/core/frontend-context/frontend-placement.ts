import { createHash } from 'node:crypto'

import {
  type FrontendDestination,
  frontendPlacementPayload,
  PRODUCT_ADMIN_CONFIG,
} from '@amcore/shared'

import type { EnvService } from '../../env/env.service.js'

export interface BrowserFrontendContext {
  readonly frontend: FrontendDestination
  readonly placementFingerprint: string
}

export function canonicalFrontendOrigin(value: string, allowLocalHttp: boolean): string {
  const url = new URL(value)
  const local =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    url.hostname.endsWith('.localhost')
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    url.origin !== value ||
    url.hostname.endsWith('.') ||
    (url.protocol !== 'https:' && !(allowLocalHttp && local && url.protocol === 'http:'))
  )
    throw new Error('Frontend origin must be canonical HTTPS (local path-mode HTTP only)')
  return url.origin
}

export function resolveFrontendPlacement(
  env: Pick<EnvService, 'get'>,
  placement = PRODUCT_ADMIN_CONFIG
): Readonly<{ site: string; admin: string; placementFingerprint: string }> {
  const pathMode = placement.mode === 'path'
  const site = canonicalFrontendOrigin(env.get('FRONTEND_URL'), pathMode)
  const configured = env.get('PRODUCT_ADMIN_ORIGIN')
  const admin = canonicalFrontendOrigin(configured ?? (pathMode ? site : ''), pathMode)
  if (pathMode ? admin !== site : new URL(admin).hostname === new URL(site).hostname)
    throw new Error('Product administration requires a distinct hostname in host mode only')
  const placementFingerprint = createHash('sha256')
    .update(frontendPlacementPayload(site, admin, placement))
    .digest('hex')
  return Object.freeze({ site, admin, placementFingerprint })
}
