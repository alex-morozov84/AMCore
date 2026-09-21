import { getTranslations } from 'next-intl/server'
import type { AdminUserListResponse } from '@amcore/shared'

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty'

import { UsersOutOfRange } from './UsersOutOfRange'
import { UsersPagination } from './UsersPagination'
import { UsersTable } from './UsersTable'

export async function UsersInventory({ response }: { response: AdminUserListResponse }) {
  const t = await getTranslations('console')
  const totalPages = Math.max(1, Math.ceil(response.total / response.limit))
  if (response.total === 0)
    return (
      <Empty className="rounded-lg border border-border">
        <EmptyHeader>
          <EmptyTitle>{t('usersEmptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('usersEmptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  if (response.page > totalPages) return <UsersOutOfRange totalPages={totalPages} />
  return (
    <>
      <UsersTable users={response.data} />
      <UsersPagination page={response.page} totalPages={totalPages} />
    </>
  )
}
