import { Suspense } from 'react'
import { getLocale, getMessages } from 'next-intl/server'
import type { AdminAuditQuery } from '@amcore/shared'

import { getConsoleAuditHref } from '@/shared/lib/console-public-href'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import { resolveAuditWindow } from './audit-date-window'
import { auditHref } from './audit-url'
import { AuditFilters } from './AuditFilters'
import { AuditResults } from './AuditResults'
import { AuditResultsSkeleton } from './AuditResultsSkeleton'
import { AuditTimeZoneProvider } from './AuditTimeZone'

interface AuditPageProps {
  query: AdminAuditQuery | null
}

export async function AuditPage({ query }: AuditPageProps) {
  const [messages, locale] = await Promise.all([getMessages(), getLocale()])
  const copy = messages.console.audit
  const baseHref = getConsoleAuditHref()
  const effectiveQuery = query && resolveAuditWindow(query)
  if (!effectiveQuery)
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold">{copy.title}</h1>
        <p role="alert">{copy.invalidFilters}</p>
        <RouteProgressLink
          prefetch={false}
          href={baseHref}
          className="underline underline-offset-2"
        >
          {copy.clear}
        </RouteProgressLink>
      </section>
    )
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-3xl font-semibold">{copy.title}</h1>
        <p className="text-muted-foreground">{copy.description}</p>
      </div>
      <AuditTimeZoneProvider>
        <AuditFilters
          key={auditHref(baseHref, effectiveQuery)}
          baseHref={baseHref}
          query={effectiveQuery}
          copy={copy}
          locale={locale}
        />
        <Suspense fallback={<AuditResultsSkeleton label={copy.loading} />}>
          <AuditResults baseHref={baseHref} query={effectiveQuery} copy={copy} />
        </Suspense>
      </AuditTimeZoneProvider>
    </section>
  )
}
