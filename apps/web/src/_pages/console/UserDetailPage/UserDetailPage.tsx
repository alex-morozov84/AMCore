import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'

import { DetailBackLink } from '@/shared/ui/console-detail/DetailChrome'
import { DetailResultsSkeleton } from '@/shared/ui/console-detail/DetailResultsSkeleton'

import { UserDetailResults } from './UserDetailResults'

export async function UserDetailPage({
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
      <DetailBackLink returnTo={returnTo} kind="user" />
      <h1 className="text-3xl font-semibold tracking-tight">{t('userTitle')}</h1>
      <Suspense fallback={<DetailResultsSkeleton searchable />}>
        <UserDetailResults id={id} page={page} search={search} returnTo={returnTo} />
      </Suspense>
    </section>
  )
}
