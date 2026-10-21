import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { type AdminAuditResponse, AUDIT_ACTIONS, DEFAULT_LOCALE } from '@amcore/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { AuditEventRow } from './AuditEventRow'

const actions = Object.fromEntries(
  AUDIT_ACTIONS.map((code) => [code, code])
) as AuditCopy['actions']
const copy = {
  actor: 'Who',
  target: 'Target',
  organization: 'Organization',
  eventId: 'Event ID',
  types: { USER: 'User' },
  actorId: 'Actor',
  targetId: 'Target',
  organizationId: 'Organization',
  filterActor: 'Filter actor',
  filterTarget: 'Filter target',
  filterOrganization: 'Filter organization',
  filterAction: 'Filter action',
  requestId: 'Request ID',
  copyId: 'Copy ID',
  copied: 'Copied',
  copyFailed: 'Could not copy',
  currentIdentity: 'Current identity — may differ from event date',
  noCurrentRecord: 'No current record',
  unavailableIdentity: 'Current label unavailable',
  unknownId: 'ID unavailable',
  unknownAction: 'Unknown action',
  timestampUtc: 'UTC',
  summaryBeforeRole: 'Previous role',
  summaryAfterRole: 'Current role',
  summaryCount: 'Count',
  summaryDecision: 'Decision',
  summaryReasonCode: 'Reason code',
  summaryOutcome: 'Outcome',
  commandDetails: {
    title: 'Details',
    workId: 'Work type ID',
    jobId: 'Task ID',
    commandId: 'Command ID',
    operation: 'Action',
    reason: 'Reason for action',
    outcome: 'Result',
    operations: { retry: 'Retry' },
    outcomes: { applied: 'Applied' },
  },
  actions,
} as unknown as AuditCopy
const item: AdminAuditResponse['items'][number] = {
  id: 'event1',
  createdAt: '2026-09-23T12:00:00.000Z',
  action: 'admin.cleanup.executed',
  actorType: 'USER',
  actorId: 'user1',
  actorIdentity: { status: 'current', name: 'New Name', email: 'new@example.com' },
  targetType: 'USER',
  targetId: 'user2',
  targetIdentity: { status: 'not_found' },
  organizationId: null,
  category: 'SECURITY',
  summary: {},
}

function renderRow(value = item, target: LogSearchTarget | null = null) {
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
        <LogSearchTargetProvider target={target}>
          <AuditEventRow item={value} baseHref="/admin/audit" query={{ limit: 25 }} copy={copy} />
        </LogSearchTargetProvider>
      </ConsoleTimeZoneProvider>
    </NextIntlClientProvider>
  )
}

describe('Audit event row', () => {
  it('shows current identity as current and keeps safe IDs filterable', () => {
    renderRow()
    expect(screen.getByText('New Name')).toBeInTheDocument()
    expect(screen.getAllByText('User')).toHaveLength(2)
    expect(screen.getByText('No current record')).toBeInTheDocument()
    expect(screen.queryByText('ID unavailable')).not.toBeInTheDocument()
    expect(screen.getByText('Event ID:')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Filter actor' })).toHaveAttribute(
      'href',
      '/admin/audit?actorId=user1&limit=25'
    )
    expect(screen.getByText('user2')).toBeInTheDocument()
  })

  it('renders safe command details with the operator reason and copyable task/command IDs', () => {
    renderRow({
      ...item,
      action: 'background_work.command_outcome',
      commandDetails: {
        commandId: '019a1234-1234-7123-8123-123456789012',
        workId: 'fixture-import',
        jobId: 'owner-retry',
        operation: 'retry',
        outcome: 'applied',
        reason: 'Test retry',
      },
    })
    expect(screen.getByText('Details')).toBeInTheDocument()
    expect(screen.getByText('Test retry')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Copy ID: owner-retry', hidden: true })
    ).toBeInTheDocument()
  })

  it('links only the task ID of the command details to the log search', () => {
    const target: LogSearchTarget = { kind: 'grafana-loki', baseUrl: 'http://localhost:3002/' }
    renderRow(
      {
        ...item,
        action: 'background_work.command_outcome',
        commandDetails: {
          commandId: '019a1234-1234-7123-8123-123456789012',
          workId: 'fixture-import',
          jobId: 'owner-retry',
          operation: 'retry',
          outcome: 'applied',
        },
      },
      target
    )
    const links = screen.getAllByRole('link', { name: /Find in logs/, hidden: true })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', logSearchHref(target, 'owner-retry'))
  })

  it('shows the request ID with copy and a log-search link, only when the event has one', () => {
    const target: LogSearchTarget = { kind: 'grafana-loki', baseUrl: 'http://localhost:3002/' }
    const { unmount } = renderRow({ ...item, requestId: 'req-55' }, target)
    expect(screen.getByText('Request ID:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy ID: req-55' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Find in logs/ })).toHaveAttribute(
      'href',
      logSearchHref(target, 'req-55')
    )
    unmount()
    renderRow(item, target)
    expect(screen.queryByText('Request ID:')).not.toBeInTheDocument()
  })

  it('shows the request ID without a link when no log-search address is configured', () => {
    renderRow({ ...item, requestId: 'req-55' })
    expect(screen.getByText('req-55')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Find in logs/ })).not.toBeInTheDocument()
  })

  it('copies a displayed ID and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderRow()
    fireEvent.click(screen.getByRole('button', { name: 'Copy ID: user1' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('user1'))
    expect(screen.getByRole('button', { name: 'Copy ID: user1' })).toHaveAttribute(
      'title',
      'Copied'
    )
  })

  it('labels a safe coded outcome so the value has meaning', () => {
    renderRow({ ...item, action: 'ai.tool.invoked', summary: { outcome: 'success' } })
    expect(screen.getByText('Outcome: success')).toBeInTheDocument()
  })
})
