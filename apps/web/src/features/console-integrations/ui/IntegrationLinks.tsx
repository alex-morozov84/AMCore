'use client'

import { useTranslations } from 'next-intl'
import type { IntegrationItem } from '@amcore/shared'

import { docsPageHref } from '@/shared/lib/console-docs-links'
import {
  getConsoleBackgroundWorkHref,
  getConsoleOverviewHref,
} from '@/shared/lib/console-public-href'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

const LINK_HREF = {
  overview: () => getConsoleOverviewHref(),
  background_work: () => getConsoleBackgroundWorkHref(),
} as const

/** Closed links only. The registration supplies no URL; each kind maps to a helper here. */
export function IntegrationLinks({ item }: { item: IntegrationItem }) {
  const t = useTranslations('console.integrations.link')
  return (
    <ul className="space-y-1 text-sm">
      {item.links.map((kind) =>
        kind === 'runbook' ? (
          <li key={kind}>
            <a
              href={docsPageHref('docs/operations-console/integrations.md')}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              {t(kind)}
            </a>
          </li>
        ) : (
          <li key={kind}>
            <RouteProgressLink
              href={LINK_HREF[kind]()}
              prefetch={false}
              className="underline underline-offset-4 hover:text-foreground"
            >
              {t(kind)}
            </RouteProgressLink>
          </li>
        )
      )}
    </ul>
  )
}
