import type { ReactElement } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/organizations' }))
vi.mock('@/shared/api/console/organizations', () => ({ fetchConsoleOrganizations: vi.fn() }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}))
// `OrganizationsInventory` has its own dedicated test file — stubbed here so
// this file only exercises what `OrganizationsResults` itself renders
// directly (the aria-live total and the unavailable fallback) and what it
// passes down.
vi.mock('./OrganizationsInventory', () => ({
  OrganizationsInventory: ({ response }: { response: { total: number } }) => (
    <div data-testid="inventory">{response.total}</div>
  ),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string, values?: Record<string, number>) => {
    if (key === 'organizationsTotal') return `${values?.total} organizations`
    return key
  }),
}))

import { fetchConsoleOrganizations } from '@/shared/api/console/organizations'

import { OrganizationsResults } from './OrganizationsResults'

const messages = {
  common: {
    temporarilyUnavailable: 'This is temporarily unavailable. Please try again.',
    retry: 'Retry',
  },
}

function renderResults(node: ReactElement) {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      {node}
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OrganizationsResults', () => {
  it('keeps a transport failure distinct from an empty inventory', async () => {
    vi.mocked(fetchConsoleOrganizations).mockResolvedValue({
      status: 'unavailable',
      reason: 'timeout',
    })

    renderResults(
      await OrganizationsResults({
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        baseHref: '/en/admin/organizations',
      })
    )

    expect(
      screen.getByText('This is temporarily unavailable. Please try again.')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('inventory')).not.toBeInTheDocument()
  })

  it('forwards page/limit/search/sortBy/sortOrder to fetchConsoleOrganizations unchanged', async () => {
    vi.mocked(fetchConsoleOrganizations).mockResolvedValue({
      status: 'success',
      data: { data: [], total: 0, page: 1, limit: 20 },
    })

    renderResults(
      await OrganizationsResults({
        page: 2,
        limit: 20,
        search: 'acme',
        sortBy: 'name',
        sortOrder: 'desc',
        baseHref: '/en/admin/organizations',
      })
    )

    expect(fetchConsoleOrganizations).toHaveBeenCalledWith({
      page: 2,
      limit: 20,
      search: 'acme',
      sortBy: 'name',
      sortOrder: 'desc',
    })
  })

  it('renders an aria-live result count and passes the response through to OrganizationsInventory', async () => {
    vi.mocked(fetchConsoleOrganizations).mockResolvedValue({
      status: 'success',
      data: { data: [], total: 3, page: 1, limit: 20 },
    })

    renderResults(
      await OrganizationsResults({
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        baseHref: '/en/admin/organizations',
      })
    )

    const total = screen.getByText('3 organizations')
    expect(total).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByTestId('inventory')).toHaveTextContent('3')
  })
})
