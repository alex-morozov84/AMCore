import { getFormatter, getTranslations } from 'next-intl/server'
import { adminDetailIdSchema } from '@amcore/shared'

import { fetchConsoleOrganizationDetail } from '@/shared/api/console/organizations'
import { detailPageHref } from '@/shared/lib/console-detail-url'
import {
  getConsoleDetailAuditHref,
  getConsoleOrganizationDetailHref,
} from '@/shared/lib/console-public-href'
import { formatConsoleDate } from '@/shared/lib/format-console-date-time'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { DetailFact, DetailId } from '@/shared/ui/console-detail/DetailChrome'
import { DetailPager } from '@/shared/ui/console-detail/DetailPager'
import { DetailRelationSearch } from '@/shared/ui/console-detail/DetailRelationSearch'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import { OrganizationMembers } from './OrganizationMembers'

export async function OrganizationDetailResults({
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
  if (!adminDetailIdSchema.safeParse(id).success) return <p role="alert">{t('invalidId')}</p>
  const [outcome, format] = await Promise.all([
    fetchConsoleOrganizationDetail(id, page, search),
    getFormatter(),
  ])
  if (outcome.status === 'not-found') return <p role="alert">{t('notFoundOrganization')}</p>
  if (outcome.status === 'unavailable')
    return <PrimaryUnavailableFallback reason={outcome.reason} />
  const { organization, memberCount, members } = outcome.data
  const totalPages = Math.max(1, Math.ceil(members.total / members.limit))
  const base = getConsoleOrganizationDetailHref(id)
  const auditHref = getConsoleDetailAuditHref({ organizationId: id })
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-xl">{organization.name}</CardTitle>
          <DetailId id={organization.id} />
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DetailFact label={t('slug')}>{organization.slug}</DetailFact>
            <DetailFact label={t('created')}>
              <time dateTime={organization.createdAt}>
                {formatConsoleDate(format, new Date(organization.createdAt))}
              </time>
            </DetailFact>
            <DetailFact label={t('updated')}>
              <time dateTime={organization.updatedAt}>
                {formatConsoleDate(format, new Date(organization.updatedAt))}
              </time>
            </DetailFact>
          </dl>
        </CardContent>
      </Card>
      <section className="space-y-4" aria-label={t('members', { count: memberCount })}>
        <h2 className="text-xl font-semibold">{t('members', { count: memberCount })}</h2>
        <DetailRelationSearch
          base={base}
          page={page}
          search={search}
          returnTo={returnTo ?? undefined}
          inputId="organization-members-search"
          label={t('searchMembers')}
          placeholder={t('searchPlaceholder')}
          clearLabel={t('clearSearch')}
        >
          {memberCount === 0 ? (
            <p className="rounded-lg border border-border p-4 text-muted-foreground">
              {t('noMembers')}
            </p>
          ) : members.total === 0 ? (
            <p className="rounded-lg border border-border p-4 text-muted-foreground">
              {t('noMatches')}
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
              <OrganizationMembers rows={members.data} />
              <DetailPager
                base={base}
                page={page}
                totalPages={totalPages}
                returnTo={returnTo ?? undefined}
                search={search}
              />
            </>
          )}
        </DetailRelationSearch>
      </section>
      <nav aria-label={t('auditOrganization')} className="space-y-2">
        <RouteProgressLink
          prefetch={false}
          href={auditHref}
          className="text-sm underline underline-offset-2"
        >
          {t('auditOrganization')}
        </RouteProgressLink>
        <p className="text-xs text-muted-foreground">{t('auditWindowNote')}</p>
      </nav>
    </div>
  )
}
