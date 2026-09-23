import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/organizations' }))
vi.mock('./OrganizationsTable', () => ({ OrganizationsTable: () => <div /> }))
vi.mock('./OrganizationsPagination', () => ({ OrganizationsPagination: () => <div /> }))
vi.mock('./OrganizationsOutOfRange', () => ({
  OrganizationsOutOfRange: ({ totalPages }: { totalPages: number }) => (
    <span>Out: {totalPages}</span>
  ),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string, values?: Record<string, number>) => {
    if (key === 'organizationsPageOutOfRangeDescription')
      return `Choose a page between 1 and ${values?.totalPages}.`
    return messages.console[key as keyof typeof messages.console] ?? key
  }),
}))

import { OrganizationsInventory } from './OrganizationsInventory'

const messages = {
  console: {
    organizationsEmptyTitle: 'No organizations yet',
    organizationsEmptyDescription: 'Organizations appear here.',
    organizationsNoSearchResultsTitle: 'No matching organizations',
    organizationsNoSearchResultsDescription: 'Try a different term.',
    organizationsPageOutOfRangeTitle: 'This page is unavailable',
    organizationsPageOutOfRangeDescription: 'Choose a page.',
    organizationsPageOutOfRangeAction: 'Go to first page',
  },
}

async function renderInventory(
  response: Parameters<typeof OrganizationsInventory>[0]['response'],
  overrides: Partial<Parameters<typeof OrganizationsInventory>[0]> = {}
) {
  const inventory = await OrganizationsInventory({
    response,
    baseHref: '/en/admin/organizations',
    sortBy: 'createdAt',
    ...overrides,
  })
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      {inventory}
    </NextIntlClientProvider>
  )
}

describe('OrganizationsInventory', () => {
  it('shows the genuinely-empty state when total is zero and no search is active', async () => {
    await renderInventory({ data: [], total: 0, page: 1, limit: 20 })
    expect(screen.getByText('No organizations yet')).toBeInTheDocument()
    expect(screen.queryByText('No matching organizations')).not.toBeInTheDocument()
  })

  it('shows the no-results-for-search state when total is zero and a search is active', async () => {
    await renderInventory({ data: [], total: 0, page: 1, limit: 20 }, { search: 'nonexistent' })
    expect(screen.getByText('No matching organizations')).toBeInTheDocument()
    expect(screen.queryByText('No organizations yet')).not.toBeInTheDocument()
  })

  it('shows an out-of-range state when organizations exist on earlier pages', async () => {
    await renderInventory({ data: [], total: 21, page: 999, limit: 20 })
    expect(screen.getByText('Out: 2')).toBeInTheDocument()
    expect(screen.queryByText('No organizations yet')).not.toBeInTheDocument()
  })
})
