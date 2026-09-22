import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import type { AdminUserResponse } from '@amcore/shared'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/admin/users',
}))
vi.mock('@/shared/api/console/access-token', () => ({
  getConsoleAwareUser: vi.fn().mockResolvedValue(null),
}))
// The role-promote/demote action has its own dedicated coverage; stubbed
// here so this file only exercises the sortable headers this table adds.
vi.mock('./UserRoleAction', () => ({ UserRoleAction: () => <div /> }))
vi.mock('next-intl/server', () => ({
  getFormatter: vi.fn().mockResolvedValue({ dateTime: () => 'Sep 21, 2026, 10:00 AM' }),
  getTranslations: vi.fn().mockResolvedValue((key: string, values?: Record<string, string>) => {
    if (key === 'sortColumnAction') return `Sort by ${values?.column}, ${values?.direction}`
    return (consoleMessages as Record<string, string>)[key] ?? key
  }),
}))

import { USERS_SORTABLE_FIELDS } from './parse-query'
import { UsersTable, type UsersTableProps } from './UsersTable'

const consoleMessages = {
  usersColumnUser: 'User',
  usersColumnVerification: 'Verification',
  usersColumnRole: 'System role',
  usersColumnLastLogin: 'Last sign-in',
  usersColumnCreated: 'Created',
  usersColumnUpdated: 'Updated',
  usersColumnActions: 'Actions',
  usersEmailVerified: 'Verified',
  usersEmailUnverified: 'Unverified',
  usersRoleUser: 'User',
  superAdminRole: 'Super admin',
  usersNeverSignedIn: 'Never',
  sortAscending: 'ascending',
  sortDescending: 'descending',
}

const user: AdminUserResponse = {
  id: 'user-1',
  email: 'alice@example.com',
  emailVerified: true,
  name: 'Alice',
  avatarUrl: null,
  phone: null,
  locale: 'en',
  timezone: 'UTC',
  systemRole: 'USER',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  lastLoginAt: '2026-01-03T00:00:00.000Z',
}

async function renderTable(overrides: Partial<UsersTableProps> = {}) {
  const table = await UsersTable({
    users: [user],
    baseHref: '/en/admin/users',
    sortBy: 'createdAt',
    ...overrides,
  })
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={{ console: consoleMessages }}>
      {table}
    </NextIntlClientProvider>
  )
}

describe('UsersTable', () => {
  it('marks the active sort column with aria-sort and a directional accessible label', async () => {
    await renderTable({ sortBy: 'createdAt', sortOrder: 'desc' })

    const createdHeader = screen.getByText('Created').closest('th')
    expect(createdHeader).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('link', { name: 'Sort by Created, ascending' })).toBeInTheDocument()
  })

  it('leaves inactive sort columns unmarked and pointed at their own default direction', async () => {
    await renderTable({ sortBy: 'createdAt', sortOrder: 'desc' })

    const nameHeader = screen.getByRole('columnheader', { name: 'Sort by User, ascending' })
    // Only the currently-sorted header carries `aria-sort` at all.
    expect(nameHeader).not.toHaveAttribute('aria-sort')
    // An inactive sortable column must still show *some* icon — otherwise
    // nothing on screen distinguishes it from a plain, non-sortable header
    // until it's clicked.
    expect(nameHeader.querySelector('svg')).toBeInTheDocument()
  })

  it('does not offer a sort affordance on the non-sortable verification/role columns', async () => {
    await renderTable()

    expect(screen.getByText('Verification').closest('th')).not.toHaveAttribute('aria-sort')
    expect(screen.getByText('System role').closest('th')).not.toHaveAttribute('aria-sort')
  })

  it('carries the current search into every sortable header link', async () => {
    await renderTable({ search: 'alice', sortBy: 'name', sortOrder: 'asc' })

    const lastLoginLink = screen.getByRole('link', { name: 'Sort by Last sign-in, descending' })
    expect(lastLoginLink).toHaveAttribute(
      'href',
      '/en/admin/users?search=alice&sortBy=lastLoginAt&sortOrder=desc'
    )
  })

  it('renders exactly one sortable header per USERS_SORTABLE_FIELDS entry — no more, no fewer', async () => {
    // Mechanical enforcement that the rendered headers and the route's
    // `sortBy` allowlist can never silently drift apart (the class of bug
    // that let a bookmarked `?sortBy=email` sort the data with no header
    // ever showing as active).
    await renderTable()

    const sortLinks = screen.getAllByRole('link', { name: /^Sort by/ })
    const renderedColumns = sortLinks
      .map((link) => new URL(link.getAttribute('href')!, 'https://x').searchParams.get('sortBy'))
      .sort()
    expect(renderedColumns).toEqual([...USERS_SORTABLE_FIELDS].sort())
  })
})
