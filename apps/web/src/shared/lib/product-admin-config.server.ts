import { createHash } from 'node:crypto'

import { frontendPlacementPayload, PRODUCT_ADMIN_CONFIG } from '@amcore/shared'

import 'server-only'

export interface ProductAdminEnvironment {
  [key: string]: string | undefined
  FRONTEND_URL?: string
  PRODUCT_ADMIN_ORIGIN?: string
  WEB_FRONTEND_CONTEXT_KEY?: string
}

function origin(value: string, allowLocalHttp: boolean): URL {
  const url = new URL(value)
  const local =
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.hostname.endsWith('.localhost')
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.hostname.endsWith('.') ||
    (url.protocol !== 'https:' && !(allowLocalHttp && local && url.protocol === 'http:'))
  )
    throw new Error('Invalid canonical frontend origin')
  return url
}

export function productAdminOrigins(env: ProductAdminEnvironment = process.env) {
  const pathMode = PRODUCT_ADMIN_CONFIG.mode === 'path'
  const site = origin(env.FRONTEND_URL ?? 'http://localhost:3002', pathMode)
  const admin = origin(env.PRODUCT_ADMIN_ORIGIN || (pathMode ? site.origin : ''), pathMode)
  if (pathMode ? admin.origin !== site.origin : admin.hostname === site.hostname)
    throw new Error(
      'Separate product administration requires a different hostname, regardless of port'
    )
  return Object.freeze({ site: site.origin, admin: admin.origin })
}

export function productAdminDeployment(env: ProductAdminEnvironment = process.env) {
  const { site, admin } = productAdminOrigins(env)
  const key = env.WEB_FRONTEND_CONTEXT_KEY
  if (!key || key.length < 32)
    throw new Error('WEB_FRONTEND_CONTEXT_KEY must contain at least 32 characters')
  const placementFingerprint = createHash('sha256')
    .update(frontendPlacementPayload(site, admin, PRODUCT_ADMIN_CONFIG))
    .digest('hex')
  return Object.freeze({ site, admin, key, placementFingerprint })
}
