import { getTranslations } from 'next-intl/server'

import { getConsoleUsersHref } from '@/shared/lib/console-public-href'
import { buttonVariants } from '@/shared/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

export async function UsersOutOfRange({ totalPages }: { totalPages: number }) {
  const t = await getTranslations('console')
  return (
    <Empty className="rounded-lg border border-border">
      <EmptyHeader>
        <EmptyTitle>{t('usersPageOutOfRangeTitle')}</EmptyTitle>
        <EmptyDescription>{t('usersPageOutOfRangeDescription', { totalPages })}</EmptyDescription>
      </EmptyHeader>
      <RouteProgressLink
        href={getConsoleUsersHref()}
        className={buttonVariants({ variant: 'outline' })}
      >
        {t('usersPageOutOfRangeAction')}
      </RouteProgressLink>
    </Empty>
  )
}
