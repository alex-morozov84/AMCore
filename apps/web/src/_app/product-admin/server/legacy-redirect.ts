import { NextResponse } from 'next/server'
import {
  coerceSupportedLocale,
  isOrganizationContextId,
  localizedFrontendUrl,
  ownKeyQuerySchema,
  productAdminPath,
  SUPPORTED_LOCALES,
} from '@amcore/shared'

import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { resolveProductWebContext } from '@/shared/api/bff/product-web-context.server'
import { productAdminOrigins } from '@/shared/lib/product-admin-config.server'

import 'server-only'

type LegacyPage =
  'organization' | 'organizations' | 'members' | 'invites' | 'roles' | 'role' | 'own-keys'

export function legacyAdminRedirect(
  request: Request,
  page: LegacyPage,
  params: {
    locale: string
    id?: string
    roleId?: string
  }
): Response {
  try {
    resolveProductWebContext(request.headers, 'site-auth')
  } catch (error) {
    if (error instanceof ContextRequestError) return new Response(null, { status: error.status })
    throw error
  }
  if (!SUPPORTED_LOCALES.some((locale) => locale === params.locale))
    return new Response(null, { status: 404 })
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405 })
  if (
    (params.id !== undefined && !isOrganizationContextId(params.id)) ||
    (params.roleId !== undefined && !isOrganizationContextId(params.roleId))
  )
    return new Response(null, { status: 404 })
  const base = params.id ? `/organizations/${params.id}` : '/organizations'
  const paths = {
    organizations: '/organizations',
    organization: base,
    members: `${base}/members`,
    invites: `${base}/invites`,
    roles: `${base}/roles`,
    role: `${base}/roles/${params.roleId}`,
    'own-keys': '/settings/api-keys',
  }
  const url = new URL(
    localizedFrontendUrl(
      productAdminOrigins().admin,
      coerceSupportedLocale(params.locale),
      productAdminPath(paths[page])
    )
  )
  const raw = new URL(request.url).searchParams
  if (page === 'own-keys') {
    const safe = Object.fromEntries(
      ['page', 'status', 'search', 'organizationId', 'organizationAvailability'].flatMap((key) =>
        raw.getAll(key).length === 1 ? [[key, raw.get(key)]] : []
      )
    )
    const parsed = ownKeyQuerySchema.safeParse(safe)
    if (parsed.success)
      for (const [key, value] of Object.entries(parsed.data))
        if (key !== 'limit' && value !== undefined) url.searchParams.set(key, String(value))
  } else {
    const pageValue = raw.get('page')
    if (raw.getAll('page').length === 1 && /^[1-9]\d{0,4}$/.test(pageValue ?? ''))
      url.searchParams.set('page', pageValue!)
    if (raw.getAll('view').length === 1 && raw.get('view') === 'list')
      url.searchParams.set('view', 'list')
    if (raw.getAll('search').length === 1 && raw.get('search')!.length <= 254)
      url.searchParams.set('search', raw.get('search')!)
    if (
      page === 'members' &&
      raw.getAll('role').length === 1 &&
      isOrganizationContextId(raw.get('role')!)
    )
      url.searchParams.set('role', raw.get('role')!)
  }
  const response = NextResponse.redirect(url, 308)
  response.headers.set('referrer-policy', 'no-referrer')
  response.headers.set('cache-control', 'private, no-store')
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  return response
}
