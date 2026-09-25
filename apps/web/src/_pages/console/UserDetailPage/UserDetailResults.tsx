import { getFormatter, getTranslations } from 'next-intl/server'
import { adminDetailIdSchema } from '@amcore/shared'

import { UserRoleAction } from '@/features/console-user-role'
import { getConsoleAwareUser } from '@/shared/api/console/access-token'
import { fetchConsoleUserDetail } from '@/shared/api/console/users'
import { detailPageHref } from '@/shared/lib/console-detail-url'
import {
  getConsoleDetailAuditHref,
  getConsoleUserDetailHref,
} from '@/shared/lib/console-public-href'
import { formatConsoleDate, formatConsoleTime } from '@/shared/lib/format-console-date-time'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { DetailFact, DetailId } from '@/shared/ui/console-detail/DetailChrome'
import { DetailPager } from '@/shared/ui/console-detail/DetailPager'
import { DetailRelationSearch } from '@/shared/ui/console-detail/DetailRelationSearch'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import { UserMemberships } from './UserMemberships'

export async function UserDetailResults({
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
  const [t, tConsole, tCommon] = await Promise.all([
    getTranslations('console.detail'),
    getTranslations('console'),
    getTranslations('common'),
  ])
  if (!adminDetailIdSchema.safeParse(id).success) return <p role="alert">{t('invalidId')}</p>
  const [outcome, format, actor] = await Promise.all([
    fetchConsoleUserDetail(id, page, search),
    getFormatter(),
    getConsoleAwareUser(),
  ])
  if (outcome.status === 'not-found') return <p role="alert">{t('notFoundUser')}</p>
  if (outcome.status === 'unavailable')
    return <PrimaryUnavailableFallback reason={outcome.reason} />
  const { user, memberships, membershipCount } = outcome.data
  const totalPages = Math.max(1, Math.ceil(memberships.total / memberships.limit))
  const base = getConsoleUserDetailHref(id)
  const auditBy = getConsoleDetailAuditHref({ actorId: id })
  const auditAbout = getConsoleDetailAuditHref({ targetType: 'USER', targetId: id })
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="gap-3 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0 space-y-2">
            <CardTitle className="text-xl">{user.name ?? user.email}</CardTitle>
            <p className="break-all text-sm text-muted-foreground">{user.email}</p>
            <DetailId id={user.id} />
          </div>
          <div className="justify-self-start sm:justify-self-end">
            <UserRoleAction
              user={{ id: user.id, systemRole: user.systemRole }}
              isSelf={user.id === actor?.id}
            />
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DetailFact label={t('verification')}>
              {t(user.emailVerified ? 'verified' : 'unverified')}
            </DetailFact>
            <DetailFact label={t('systemRole')}>
              {tConsole(user.systemRole === 'SUPER_ADMIN' ? 'superAdminRole' : 'usersRoleUser')}
            </DetailFact>
            <DetailFact label={t('phone')}>{user.phone ?? tCommon('notAvailable')}</DetailFact>
            <DetailFact label={t('lastSignIn')}>
              {user.lastLoginAt ? (
                <time dateTime={user.lastLoginAt}>
                  {formatConsoleDate(format, new Date(user.lastLoginAt))} ·{' '}
                  {formatConsoleTime(format, new Date(user.lastLoginAt))}
                </time>
              ) : (
                tCommon('notAvailable')
              )}
            </DetailFact>
            <DetailFact label={t('created')}>
              <time dateTime={user.createdAt}>
                {formatConsoleDate(format, new Date(user.createdAt))}
              </time>
            </DetailFact>
            <DetailFact label={t('updated')}>
              <time dateTime={user.updatedAt}>
                {formatConsoleDate(format, new Date(user.updatedAt))}
              </time>
            </DetailFact>
          </dl>
        </CardContent>
      </Card>
      <section className="space-y-4" aria-label={t('organizations', { count: membershipCount })}>
        <h2 className="text-xl font-semibold">{t('organizations', { count: membershipCount })}</h2>
        <DetailRelationSearch
          base={base}
          page={page}
          search={search}
          returnTo={returnTo ?? undefined}
          inputId="user-organizations-search"
          label={t('searchOrganizations')}
          placeholder={t('searchOrganizationsPlaceholder')}
          clearLabel={t('clearOrganizationsSearch')}
        />
        {membershipCount === 0 ? (
          <p className="rounded-lg border border-border p-4 text-muted-foreground">
            {t('noMemberships')}
          </p>
        ) : memberships.total === 0 ? (
          <p className="rounded-lg border border-border p-4 text-muted-foreground">
            {t('noOrganizationMatches')}
          </p>
        ) : page > totalPages ? (
          <p role="alert" className="rounded-lg border border-border p-4">
            {t('outOfRange')}{' '}
            <RouteProgressLink
              prefetch={false}
              href={detailPageHref(base, 1, returnTo ?? undefined, search)}
              className="underline"
            >
              {t('firstPage')}
            </RouteProgressLink>
          </p>
        ) : (
          <>
            <UserMemberships rows={memberships.data} />
            <DetailPager
              base={base}
              page={page}
              totalPages={totalPages}
              returnTo={returnTo ?? undefined}
              search={search}
            />
          </>
        )}
      </section>
      <nav aria-label={tConsole('auditTitle')} className="space-y-2">
        <div className="flex flex-wrap gap-4 text-sm">
          <RouteProgressLink
            prefetch={false}
            href={auditBy}
            className="underline underline-offset-2"
          >
            {t('auditByUser')}
          </RouteProgressLink>
          <RouteProgressLink
            prefetch={false}
            href={auditAbout}
            className="underline underline-offset-2"
          >
            {t('auditAboutUser')}
          </RouteProgressLink>
        </div>
        <p className="text-xs text-muted-foreground">{t('auditWindowNote')}</p>
      </nav>
    </div>
  )
}
