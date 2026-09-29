'use client'

import { useTranslations } from 'next-intl'
import type { OrganizationListResponse } from '@amcore/shared'

import { Button } from '@/shared/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/shared/ui/empty'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/shared/ui/pagination'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

export interface OrganizationSelectProps {
  list: OrganizationListResponse
  contextHref: (id: string) => string
  pageHref: (page: number) => string
  dashboardHref: string
}

export function OrganizationSelect({
  list,
  contextHref,
  pageHref,
  dashboardHref,
}: OrganizationSelectProps) {
  const t = useTranslations('organizationAccess')
  if (list.total === 0)
    return (
      <Card>
        <Empty>
          <EmptyHeader>
            <h2 className="font-semibold">{t('emptyTitle')}</h2>
            <EmptyDescription>{t('emptyGuidance')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" render={<RouteProgressLink href={dashboardHref} />}>
              {t('dashboard')}
            </Button>
          </EmptyContent>
        </Empty>
      </Card>
    )
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {list.data.map((org) => (
          <Card key={org.id}>
            <CardHeader>
              <CardTitle as="h2" className="break-words">
                {org.name}
              </CardTitle>
              <CardDescription className="break-all">{org.slug}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button
                render={
                  <RouteProgressLink
                    href={contextHref(org.id)}
                    prefetch={false}
                    aria-label={t('openNamed', { name: org.name })}
                  />
                }
              >
                {t('open')}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
      {Math.ceil(list.total / list.limit) > 1 && (
        <Pagination aria-label={t('pagination')}>
          <PaginationContent>
            {list.page > 1 && (
              <PaginationItem>
                <PaginationPrevious
                  label={t('previous')}
                  href={pageHref(list.page - 1)}
                  prefetch={false}
                />
              </PaginationItem>
            )}
            <PaginationItem>
              <span className="px-3 text-sm text-muted-foreground">
                {t('page', { page: list.page, total: Math.ceil(list.total / list.limit) })}
              </span>
            </PaginationItem>
            {list.page < Math.ceil(list.total / list.limit) && (
              <PaginationItem>
                <PaginationNext label={t('next')} href={pageHref(list.page + 1)} prefetch={false} />
              </PaginationItem>
            )}
          </PaginationContent>
        </Pagination>
      )}
    </div>
  )
}
