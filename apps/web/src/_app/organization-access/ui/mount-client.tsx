'use client'

import { useLocale } from 'next-intl'
import type { ProductAccessBootstrap } from '@amcore/shared'

import { OrganizationAccessClient } from '@/_pages/organization-access'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

export function OrganizationAccessClientMount({
  admission,
  id,
  page,
  explicitList,
}: {
  admission: ProductAccessBootstrap
  id?: string
  page: number
  explicitList: boolean
}) {
  const router = useRouteProgressRouter()
  const locale = useLocale()
  return (
    <OrganizationAccessClient
      admission={admission}
      input={id ? { kind: 'selected', id, locale } : { kind: 'list', page, locale }}
      explicitList={explicitList}
      contextHref={(value) => `/organizations/${encodeURIComponent(value)}`}
      pageHref={(value) => `/organizations?view=list&page=${value}`}
      listHref="/organizations?view=list"
      loginHref="/login"
      dashboardHref="/"
      onReplace={(href) => router.replace(href)}
      onReload={() => window.location.reload()}
    />
  )
}
