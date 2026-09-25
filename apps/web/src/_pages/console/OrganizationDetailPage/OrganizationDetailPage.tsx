import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'

import { DetailBackLink } from '@/shared/ui/console-detail/DetailChrome'
import { DetailResultsSkeleton } from '@/shared/ui/console-detail/DetailResultsSkeleton'

import { OrganizationDetailResults } from './OrganizationDetailResults'

export async function OrganizationDetailPage({
  id,
  page,
  search,
  returnTo,
}: {
  id: string
  page: number
  search?: string
  returnTo: string | null
}) {
  const t = await getTranslations('console.detail')
  return (
    <section className="space-y-5">
      <DetailBackLink returnTo={returnTo} kind="organization" />
      <h1 className="text-3xl font-semibold tracking-tight">{t('organizationTitle')}</h1>
      <Suspense fallback={<DetailResultsSkeleton searchable />}>
        <OrganizationDetailResults id={id} page={page} search={search} returnTo={returnTo} />
      </Suspense>
    </section>
  )
}
