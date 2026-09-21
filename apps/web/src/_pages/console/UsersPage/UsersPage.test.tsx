import type { ReactElement } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/users' }))

import { fetchConsoleUsers } from '@/shared/api/console/users'

import { UsersPage } from './UsersPage'

vi.mock('@/shared/api/console/users', () => ({ fetchConsoleUsers: vi.fn() }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('next-intl/server', () => ({
  getFormatter: vi.fn().mockResolvedValue({ dateTime: () => 'Sep 21, 2026, 10:00 AM' }),
  getTranslations: vi.fn().mockResolvedValue((key: string, values?: Record<string, number>) => {
    if (key === 'usersTotal') return `${values?.total} users`
    return (consoleMessages as Record<string, string>)[key] ?? key
  }),
}))

const consoleMessages = {
  users: 'Users',
  usersEmptyTitle: 'No users yet',
  usersEmptyDescription: 'Platform users will appear here once they exist.',
  usersColumnUser: 'User',
  usersColumnVerification: 'Verification',
  usersColumnRole: 'System role',
  usersColumnLastLogin: 'Last sign-in',
  usersColumnCreated: 'Created',
  usersColumnUpdated: 'Updated',
  usersEmailVerified: 'Verified',
  usersEmailUnverified: 'Unverified',
  usersRoleUser: 'User',
  superAdminRole: 'Super admin',
  usersNeverSignedIn: 'Never',
  usersPageOutOfRangeTitle: 'This page is unavailable',
  usersPageOutOfRangeDescription: 'Choose a page between 1 and 2.',
  usersPageOutOfRangeAction: 'Go to first page',
  paginationPrevious: 'Previous',
  paginationNext: 'Next',
  paginationStatus: 'Page 1 of 1',
}
const messages = {
  console: consoleMessages,
  common: {
    temporarilyUnavailable: 'This is temporarily unavailable. Please try again.',
    retry: 'Retry',
  },
}

function renderPage(page: ReactElement) {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      {page}
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('UsersPage', () => {
  it('keeps a transport failure distinct from an empty inventory', async () => {
    vi.mocked(fetchConsoleUsers).mockResolvedValue({ status: 'unavailable', reason: 'timeout' })

    renderPage(await UsersPage({ page: 1, limit: 20 }))

    expect(
      screen.getByText('This is temporarily unavailable. Please try again.')
    ).toBeInTheDocument()
    expect(screen.queryByText('No users yet')).not.toBeInTheDocument()
  })
})
