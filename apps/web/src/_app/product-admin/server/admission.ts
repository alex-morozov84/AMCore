import { headers } from 'next/headers'
import { getLocale } from 'next-intl/server'
import { productAdminPath, type ProductAdminReturn, productAdminReturnSchema } from '@amcore/shared'

import { redirect } from '@/i18n/navigation'
import { getOptionalSession } from '@/shared/api/bff/dal'
import { resolveProductWebContext } from '@/shared/api/bff/product-web-context.server'

import 'server-only'

export async function requireProductAdmin(
  target: Omit<ProductAdminReturn, 'locale'>,
  raw: Record<string, string | string[] | undefined> = {}
) {
  resolveProductWebContext(await headers(), 'admin-auth')
  const locale = await getLocale()
  const session = await getOptionalSession('admin-auth')
  if (session) return session
  const keys = ['page', 'search']
  if (target.page === 'organizations') keys.push('view')
  if (target.page === 'invites' || target.page === 'own-keys') keys.push('status')
  if (target.page === 'members') keys.push('role')
  if (target.page === 'own-keys') keys.push('organizationId', 'organizationAvailability')
  const selected = Object.fromEntries(
    keys.flatMap((key) =>
      typeof raw[key] === 'string' ? [[key, key === 'page' ? Number(raw[key]) : raw[key]]] : []
    )
  )
  const withQuery = productAdminReturnSchema.safeParse({ ...target, locale, query: selected })
  const parsed = withQuery.success
    ? withQuery
    : productAdminReturnSchema.safeParse({ ...target, locale })
  const query = parsed.success ? `?returnTo=${encodeURIComponent(JSON.stringify(parsed.data))}` : ''
  return redirect({ href: `${productAdminPath('/login')}${query}`, locale })
}
