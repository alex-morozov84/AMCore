import type { ReactElement, ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  usePathname: () => '/admin/organizations',
}))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}))
// `OrganizationsResults` (the part that actually fetches) has its own
// dedicated test file. Stubbed here as a synchronous spy so this file only
// exercises what `OrganizationsPage` itself renders directly — the heading
// and search box — and what props it hands down.
const organizationsResultsSpy = vi.fn((_props: unknown) => <div data-testid="results" />)
vi.mock('./OrganizationsResults', () => ({
  OrganizationsResults: (props: unknown) => organizationsResultsSpy(props),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: vi
    .fn()
    .mockResolvedValue((key: string) => (consoleMessages as Record<string, string>)[key] ?? key),
}))

import { OrganizationsPage } from './OrganizationsPage'

const consoleMessages = {
  organizations: 'Organizations',
  organizationsSearchLabel: 'Search organizations',
  organizationsSearchPlaceholder: 'Search by name or slug',
  organizationsSearchClear: 'Clear search',
}
const messages = { console: consoleMessages }

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

describe('OrganizationsPage', () => {
  it('renders the heading and search box immediately — neither depends on the backend fetch', async () => {
    renderPage(await OrganizationsPage({ page: 1, limit: 20 }))

    expect(screen.getByRole('heading', { name: 'Organizations' })).toBeInTheDocument()
    expect(screen.getByLabelText('Search organizations')).toBeInTheDocument()
  })

  it('gives the search box the current search value as its default', async () => {
    renderPage(await OrganizationsPage({ page: 1, limit: 20, search: 'acme' }))

    expect(screen.getByLabelText('Search organizations')).toHaveValue('acme')
  })

  it('forwards page/limit/search/sortBy/sortOrder to OrganizationsResults, defaulting sortBy to createdAt', async () => {
    renderPage(await OrganizationsPage({ page: 1, limit: 20 }))

    expect(organizationsResultsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        limit: 20,
        search: undefined,
        sortBy: 'createdAt',
        sortOrder: undefined,
      })
    )
  })

  it('forwards an explicit search/sortBy/sortOrder unchanged', async () => {
    renderPage(
      await OrganizationsPage({
        page: 1,
        limit: 20,
        search: 'acme',
        sortBy: 'name',
        sortOrder: 'desc',
      })
    )

    expect(organizationsResultsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'acme', sortBy: 'name', sortOrder: 'desc' })
    )
  })
})
