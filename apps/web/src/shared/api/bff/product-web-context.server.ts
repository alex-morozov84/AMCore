import {
  type BrowserAudience,
  type FrontendDestination,
  PRODUCT_ADMIN_CONFIG,
  productAdminPath,
  WEB_FRONTEND_HEADERS,
} from '@amcore/shared'

import { productAdminDeployment } from '@/shared/lib/product-admin-config.server'

import { ContextRequestError } from './context-errors'
import { sessionCookieOptions } from './session-cookie'
import { redisVaultLock } from './session-lock'
import { createRedisVaultLock } from './session-lock-factory'
import { redisVaultStore } from './session-vault-store'
import { createRedisVaultStore } from './session-vault-store-factory'

import 'server-only'

export type ProductRouteKind =
  'site-auth' | 'admin-auth' | 'product-data' | 'legacy-invite' | 'admin-invite'
const staffStore = createRedisVaultStore('web:staff-session:v1', 'staff')
const staffLock = createRedisVaultLock('web:staff-session:v1')

function matchesOrigin(authority: string, origin: string): boolean {
  try {
    const configured = new URL(origin)
    return new URL(`${configured.protocol}//${authority}`).host === configured.host
  } catch {
    return false
  }
}

/** Host and the literal server entry choose the audience; never a caller header or cookie. */
export function resolveProductWebContext(source: Headers, routeKind: ProductRouteKind) {
  const config = productAdminDeployment()
  const raw = source.get('host')
  if (!raw || /[\s/@\\,#?]/.test(raw)) throw new ContextRequestError(404, 'NOT_FOUND')
  const staff = PRODUCT_ADMIN_CONFIG.mode === 'host' && matchesOrigin(raw, config.admin)
  if (!matchesOrigin(raw, config.site) && !staff) throw new ContextRequestError(404, 'NOT_FOUND')
  if ((routeKind === 'site-auth' || routeKind === 'legacy-invite') && staff)
    throw new ContextRequestError(404, 'NOT_FOUND')
  if (
    PRODUCT_ADMIN_CONFIG.mode === 'host' &&
    (routeKind === 'admin-auth' || routeKind === 'admin-invite') &&
    !staff
  )
    throw new ContextRequestError(404, 'NOT_FOUND')
  const frontend: FrontendDestination =
    staff || routeKind === 'admin-auth' || routeKind === 'admin-invite' ? 'admin' : 'site'
  const origin = frontend === 'admin' ? config.admin : config.site
  return Object.freeze({
    frontend,
    audience: staff ? ('staff' as const) : ('product' as const),
    origin,
    siteOrigin: config.site,
    placementFingerprint: config.placementFingerprint,
    cookieName: staff ? '__Host-amcore_staff_session' : 'amcore_session',
    cookieOptions: Object.freeze({ ...sessionCookieOptions(), ...(staff ? { secure: true } : {}) }),
    namespace: staff ? 'web:staff-session:v1' : 'web:session:v1',
    store: staff ? staffStore : redisVaultStore,
    lock: staff ? staffLock : redisVaultLock,
    loginPath: frontend === 'admin' ? productAdminPath('/login', PRODUCT_ADMIN_CONFIG) : '/login',
    entryPath:
      frontend === 'admin' ? productAdminPath('/organizations', PRODUCT_ADMIN_CONFIG) : '/',
    apiHeaders: Object.freeze({
      [WEB_FRONTEND_HEADERS.frontend]: frontend,
      [WEB_FRONTEND_HEADERS.placement]: config.placementFingerprint,
      [WEB_FRONTEND_HEADERS.key]: config.key,
      origin,
    }),
  })
}

export type ProductWebContext = Omit<
  ReturnType<typeof resolveProductWebContext>,
  'audience' | 'apiHeaders' | 'cookieName' | 'namespace'
> & {
  cookieName: string
  namespace: string
  audience: BrowserAudience
  apiHeaders: Readonly<Record<string, string>>
}

export function isProductMutationTrusted(request: Request, context: ProductWebContext): boolean {
  const rawOrigin = request.headers.get('origin')
  if (rawOrigin !== null) return rawOrigin === context.origin
  const referer = request.headers.get('referer')
  try {
    return referer !== null && new URL(referer).origin === context.origin
  } catch {
    return false
  }
}

export function frontendApiHeaders(context: ProductWebContext, source?: HeadersInit): Headers {
  const result = new Headers(source)
  for (const [key, value] of Object.entries(context.apiHeaders)) result.set(key, value)
  return result
}
