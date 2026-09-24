import { Suspense } from 'react'
import { getLocale, getMessages } from 'next-intl/server'
import type { AdminAuditQuery } from '@amcore/shared'

import { getConsoleAuditHref } from '@/shared/lib/console-public-href'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import type { AuditCopy } from './audit-copy'
import { auditHref } from './audit-url'
import { AuditFilters } from './AuditFilters'
import { AuditResults } from './AuditResults'

interface AuditPageProps {
  query: AdminAuditQuery | null
}

export async function AuditPage({ query }: AuditPageProps) {
  const [messages, locale] = await Promise.all([getMessages(), getLocale()])
  const copy = messages.console.audit as AuditCopy
  const baseHref = getConsoleAuditHref()
  if (!query)
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
      <AuditFilters
        key={auditHref(baseHref, query)}
        baseHref={baseHref}
        query={query}
        copy={copy}
      />
      <Suspense
        fallback={
          <p role="status" className="text-muted-foreground">
            {copy.loading}
          </p>
        }
      >
        <AuditResults baseHref={baseHref} query={query} copy={copy} locale={locale} />
      </Suspense>
    </section>
  )
}
