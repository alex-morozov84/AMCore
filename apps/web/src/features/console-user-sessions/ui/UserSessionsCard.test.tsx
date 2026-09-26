import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/users/user-1',
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}))

import { useRevokeAllSessions } from '../model/use-revoke-all-sessions'
import { useUserSessions } from '../model/use-user-sessions'

import { UserSessionsCard } from './UserSessionsCard'

vi.mock('../model/use-user-sessions', () => ({ useUserSessions: vi.fn() }))
vi.mock('../model/use-revoke-all-sessions', () => ({ useRevokeAllSessions: vi.fn() }))
vi.mock('@/shared/ui/console-step-up-dialog', () => ({ ConsoleStepUpDialog: () => null }))
vi.mock('./SessionRowMenu', () => ({ SessionRowMenu: () => null }))

const messages = {
  common: { cancel: 'Cancel', retry: 'Retry', temporarilyUnavailable: 'Temporarily unavailable.' },
  console: {
    userSessionsHeading: 'Sessions ({count} total)',
    userSessionsRefresh: 'Refresh',
    userSessionsRevokeAll: 'Revoke all sessions',
    userSessionsRevokeAllConfirmTitle: 'Revoke all sessions?',
    userSessionsRevokeAllConfirmDescription: 'This ends every active session for {email}.',
    userSessionsEmpty: 'No active sessions.',
    userSessionsLastAuthenticated: 'Last authenticated',
    userSessionsLatestTokenIssued: 'Latest token issued',
    userSessionsExpires: 'Expires',
    userSessionsSelfNote: 'To manage your own sessions, use <link>Settings</link>.',
  },
  sessions: {
    device: 'Device',
    deviceLabel: '{browser} on {os}',
    deviceUnknown: 'Unknown browser',
    locationUnavailable: 'Location unavailable',
    locationAttribution: 'Approximate location by <link>DB-IP.com</link>',
    previous: 'Previous',
    next: 'Next',
  },
}

const refetch = vi.fn()
const confirmAll = vi.fn()

function mockSessions(overrides: Partial<ReturnType<typeof useUserSessions>> = {}) {
  vi.mocked(useUserSessions).mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
    refetch,
    page: 1,
    setPage: vi.fn(),
    pageSize: 20,
    ...overrides,
  } as ReturnType<typeof useUserSessions>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useRevokeAllSessions).mockReturnValue({
    confirm: confirmAll,
    isSubmitting: false,
    stepUp: { kind: 'closed' },
    isSteppingUp: false,
    submitStepUp: vi.fn(),
    closeStepUp: vi.fn(),
  })
})

function renderCard(props: Partial<{ isSelf: boolean }> = {}) {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <UserSessionsCard
        userId="user-1"
        targetEmail="target@example.com"
        isSelf={props.isSelf ?? false}
      />
    </NextIntlClientProvider>
  )
}

const sessionRow = {
  sessionId: 'a'.repeat(32),
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0.0.0',
  ipAddress: '203.0.0.1',
  location: null,
  lastAuthAt: '2026-09-24T14:02:00.000Z',
  createdAt: '2026-09-26T09:10:00.000Z',
  expiresAt: '2026-10-03T09:10:00.000Z',
}

describe('UserSessionsCard', () => {
  it('shows a loading skeleton while pending', () => {
    mockSessions({ isPending: true })
    const { container } = renderCard()

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('shows the retryable error fallback and calls refetch (not router.refresh) on retry', async () => {
    const user = userEvent.setup()
    mockSessions({ isError: true })
    renderCard()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows the empty state when there are no active sessions', () => {
    mockSessions({ data: { data: [], total: 0, page: 1, limit: 20 } })
    renderCard()

    expect(screen.getByText('No active sessions.')).toBeInTheDocument()
  })

  it('renders a populated session row with the global total, not the page length', () => {
    mockSessions({ data: { data: [sessionRow], total: 7, page: 1, limit: 20 } })
    renderCard()

    expect(screen.getByText('Sessions (7 total)')).toBeInTheDocument()
    expect(screen.getAllByText('Chrome on macOS').length).toBeGreaterThan(0)
  })

  it('shows the self-note and hides the destructive controls when viewing the operator’s own detail page', () => {
    mockSessions({ data: { data: [sessionRow], total: 1, page: 1, limit: 20 } })
    renderCard({ isSelf: true })

    expect(screen.getByText(/To manage your own sessions/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke all sessions' })).not.toBeInTheDocument()
  })

  it('confirms revoke-all via the hook after the operator confirms the destructive dialog', async () => {
    const user = userEvent.setup()
    mockSessions({ data: { data: [sessionRow], total: 1, page: 1, limit: 20 } })
    renderCard()

    await user.click(screen.getByRole('button', { name: 'Revoke all sessions' }))
    const dialog = within(await screen.findByRole('alertdialog'))
    expect(dialog.getByText(/target@example\.com/)).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Revoke all sessions' }))

    expect(confirmAll).toHaveBeenCalledTimes(1)
  })

  it('disables "Revoke all sessions" when there are zero active sessions', () => {
    mockSessions({ data: { data: [], total: 0, page: 1, limit: 20 } })
    renderCard()

    // Empty state hides the table, but the header button remains for a
    // consistent header — disabled, per the plan's acceptance criteria.
    expect(screen.getByRole('button', { name: 'Revoke all sessions' })).toBeDisabled()
  })
})
