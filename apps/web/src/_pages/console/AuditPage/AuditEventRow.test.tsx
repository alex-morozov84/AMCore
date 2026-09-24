import type { ReactNode } from 'react'
import { type AdminAuditResponse, AUDIT_ACTIONS } from '@amcore/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

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

describe('Audit event row', () => {
  it('shows current identity as current and keeps safe IDs filterable', () => {
    render(
      <AuditEventRow
        item={item}
        baseHref="/admin/audit"
        query={{ limit: 25 }}
        copy={copy}
        locale="en"
      />
    )
    expect(screen.getByText('New Name')).toBeInTheDocument()
    expect(screen.getByText('Current identity — may differ from event date')).toBeInTheDocument()
    expect(screen.getByText('No current record')).toBeInTheDocument()
    expect(screen.queryByText('ID unavailable')).not.toBeInTheDocument()
    expect(screen.getByText('Event ID:')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Filter actor' })).toHaveAttribute(
      'href',
      '/admin/audit?actorId=user1&limit=25'
    )
    expect(screen.getByText('user2')).toBeInTheDocument()
  })

  it('copies a displayed ID and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(
      <AuditEventRow
        item={item}
        baseHref="/admin/audit"
        query={{ limit: 25 }}
        copy={copy}
        locale="en"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy ID: user1' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('user1'))
    expect(screen.getByText('Copied')).toBeInTheDocument()
  })

  it('labels a safe coded outcome so the value has meaning', () => {
    render(
      <AuditEventRow
        item={{ ...item, action: 'ai.tool.invoked', summary: { outcome: 'success' } }}
        baseHref="/admin/audit"
        query={{ limit: 25 }}
        copy={copy}
        locale="en"
      />
    )
    expect(screen.getByText('Outcome: success')).toBeInTheDocument()
  })
})
