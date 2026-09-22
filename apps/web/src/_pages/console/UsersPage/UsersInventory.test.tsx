import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/users' }))
vi.mock('./UsersTable', () => ({ UsersTable: () => <div /> }))
vi.mock('./UsersPagination', () => ({ UsersPagination: () => <div /> }))
vi.mock('./UsersOutOfRange', () => ({
  UsersOutOfRange: ({ totalPages }: { totalPages: number }) => <span>Out: {totalPages}</span>,
}))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string, values?: Record<string, number>) => {
    if (key === 'usersPageOutOfRangeDescription')
      return `Choose a page between 1 and ${values?.totalPages}.`
    return messages.console[key as keyof typeof messages.console] ?? key
  }),
}))

import { UsersInventory } from './UsersInventory'

const messages = {
  console: {
    usersEmptyTitle: 'No users yet',
    usersEmptyDescription: 'Users appear here.',
    usersNoSearchResultsTitle: 'No matching users',
    usersNoSearchResultsDescription: 'Try a different term.',
    usersPageOutOfRangeTitle: 'This page is unavailable',
    usersPageOutOfRangeDescription: 'Choose a page.',
    usersPageOutOfRangeAction: 'Go to first page',
  },
}

async function renderInventory(
  response: Parameters<typeof UsersInventory>[0]['response'],
  overrides: Partial<Parameters<typeof UsersInventory>[0]> = {}
) {
  const inventory = await UsersInventory({
    response,
    baseHref: '/en/admin/users',
    sortBy: 'createdAt',
    ...overrides,
  })
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      {inventory}
    </NextIntlClientProvider>
  )
}

describe('UsersInventory', () => {
  it('shows the genuinely-empty state when total is zero and no search is active', async () => {
    await renderInventory({ data: [], total: 0, page: 1, limit: 20 })
    expect(screen.getByText('No users yet')).toBeInTheDocument()
    expect(screen.queryByText('No matching users')).not.toBeInTheDocument()
  })

  it('shows the no-results-for-search state when total is zero and a search is active', async () => {
    await renderInventory({ data: [], total: 0, page: 1, limit: 20 }, { search: 'nonexistent' })
    expect(screen.getByText('No matching users')).toBeInTheDocument()
    expect(screen.queryByText('No users yet')).not.toBeInTheDocument()
  })

  it('shows an out-of-range state when users exist on earlier pages', async () => {
    await renderInventory({ data: [], total: 21, page: 999, limit: 20 })
    expect(screen.getByText('Out: 2')).toBeInTheDocument()
    expect(screen.queryByText('No users yet')).not.toBeInTheDocument()
  })
})
