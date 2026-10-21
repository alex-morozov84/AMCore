import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { type AdminAuditResponse, DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/audit' }))

import { ConsoleTimeZoneProvider } from '@/shared/lib/console-time-zone'
import { LogSearchTargetProvider } from '@/shared/lib/log-search-context'
import { logSearchHref, type LogSearchTarget } from '@/shared/lib/log-search-link'

import type { AuditCopy } from './audit-copy'
import { AuditEventTable } from './AuditEventTable'

/** Any copy key reads as its own name; nested groups (types, actions) resolve the same way. */
function namedCopy(): AuditCopy {
  const named = (path: string): unknown =>
    new Proxy(() => path, {
      get: (_, key) => (key === Symbol.toPrimitive ? () => path : named(`${path}.${String(key)}`)),
    })
  return named('') as AuditCopy
}

const item: AdminAuditResponse['items'][number] = {
  id: 'event1',
  requestId: 'req-55',
  createdAt: '2026-09-23T12:00:00.000Z',
  action: 'admin.audit_logs.viewed',
  actorType: 'USER',
  actorId: 'user1',
  targetType: null,
  targetId: null,
  organizationId: null,
  category: 'SECURITY',
  summary: {},
}
const target: LogSearchTarget = { kind: 'grafana-loki', baseUrl: 'http://localhost:3002/' }

function renderTable(value: typeof item, linkTarget: LogSearchTarget | null) {
  return render(
    <NextIntlClientProvider
      locale={DEFAULT_LOCALE}
      messages={{
        console: {
          logSearchLink: 'Find in logs',
          overviewPublicOpenNewTab: '(opens in a new tab)',
        },
      }}
    >
      <ConsoleTimeZoneProvider>
        <LogSearchTargetProvider target={linkTarget}>
          <AuditEventTable
            items={[value]}
            baseHref="/admin/audit"
            query={{ limit: 25 }}
            copy={namedCopy()}
          />
        </LogSearchTargetProvider>
      </ConsoleTimeZoneProvider>
    </NextIntlClientProvider>
  )
}

describe('Audit event table', () => {
  it('shows the request ID with the log-search link in the event column', () => {
    renderTable(item, target)
    expect(screen.getByText('req-55')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Find in logs/ })).toHaveAttribute(
      'href',
      logSearchHref(target, 'req-55')
    )
  })

  it('shows no request ID row when the event has none', () => {
    renderTable({ ...item, requestId: undefined }, target)
    expect(screen.queryByText('req-55')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Find in logs/ })).not.toBeInTheDocument()
  })

  it('keeps the ID visible without a link when no log-search address is configured', () => {
    renderTable(item, null)
    expect(screen.getByText('req-55')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Find in logs/ })).not.toBeInTheDocument()
  })
})
