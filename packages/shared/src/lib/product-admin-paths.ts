import config from '../config/product-admin.json'
import {
  type FrontendDestination,
  type ProductAdminConfig,
  productAdminConfigSchema,
  type ProductAdminReturn,
  productAdminReturnSchema,
} from '../schemas/frontend-context'
import { utf8Bytes } from '../schemas/organization-members-budget'

export const PRODUCT_ADMIN_CONFIG: Readonly<ProductAdminConfig> = Object.freeze(
  productAdminConfigSchema.parse(config)
)

/** Locale-neutral public paths. Physical routes always retain the alias. */
export function productAdminPath(suffix = '', placement = PRODUCT_ADMIN_CONFIG): string {
  const path = suffix === '/' ? '' : suffix
  if (path && !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path))
    throw new Error('Invalid admin path')
  const config =
    placement === PRODUCT_ADMIN_CONFIG ? placement : productAdminConfigSchema.parse(placement)
  const prefix = config.mode === 'path' ? `/${config.alias}` : ''
  return `${prefix}${path}` || '/'
}

export function frontendAuthPath(frontend: FrontendDestination, path: string): string {
  return frontend === 'admin' ? productAdminPath(path) : path
}

export function parseProductAdminReturn(raw: unknown): ProductAdminReturn | undefined {
  if (typeof raw !== 'string' || raw.length > 1024 || utf8Bytes(raw) > 1024) return undefined
  try {
    const result = productAdminReturnSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : undefined
  } catch {
    return undefined
  }
}

export function productAdminReturnPath(target: ProductAdminReturn): string {
  const value = productAdminReturnSchema.parse(target)
  const base = value.orgId ? `/organizations/${value.orgId}` : '/organizations'
  const paths: Record<ProductAdminReturn['page'], string> = {
    organizations: '/organizations',
    organization: base,
    members: `${base}/members`,
    invites: `${base}/invites`,
    roles: `${base}/roles`,
    role: `${base}/roles/${value.roleId}`,
    'own-keys': '/settings/api-keys',
    sessions: '/settings/sessions',
  }
  const query = Object.entries(value.query ?? {})
    .map(([key, entry]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(entry))}`)
    .join('&')
  return `${productAdminPath(paths[value.page])}${query ? `?${query}` : ''}`
}

/** Hash this stable, nonsecret payload on the server, never include the hop key. */
export function frontendPlacementPayload(
  site: string,
  admin: string,
  placement = PRODUCT_ADMIN_CONFIG
): string {
  return JSON.stringify([1, placement.mode, placement.alias, site, admin, 1])
}
