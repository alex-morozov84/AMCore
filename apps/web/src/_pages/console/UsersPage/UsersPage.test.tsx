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
  usePathname: () => '/admin/users',
}))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}))
// `UsersResults` (the part that actually fetches) has its own dedicated
// test file. Stubbed here as a synchronous spy so this file only exercises
// what `UsersPage` itself renders directly — the heading and search box —
// and what props it hands down, without touching the network or hitting
// this harness's "async Server Component" rendering limitation (see
// `UsersResults.test.tsx`'s own note on that).
const usersResultsSpy = vi.fn((_props: unknown) => <div data-testid="results" />)
vi.mock('./UsersResults', () => ({ UsersResults: (props: unknown) => usersResultsSpy(props) }))
vi.mock('next-intl/server', () => ({
  getTranslations: vi
    .fn()
    .mockResolvedValue((key: string) => (consoleMessages as Record<string, string>)[key] ?? key),
}))

import { UsersPage } from './UsersPage'

const consoleMessages = {
  users: 'Users',
  usersSearchLabel: 'Search users',
  usersSearchPlaceholder: 'Search by name or email',
  usersSearchClear: 'Clear search',
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

describe('UsersPage', () => {
  it('renders the heading and search box immediately — neither depends on the backend fetch', async () => {
    renderPage(await UsersPage({ page: 1, limit: 20 }))

    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(screen.getByLabelText('Search users')).toBeInTheDocument()
  })

  it('gives the search box the current search value as its default', async () => {
    renderPage(await UsersPage({ page: 1, limit: 20, search: 'alice' }))

    expect(screen.getByLabelText('Search users')).toHaveValue('alice')
  })

  it('forwards page/limit/search/sortBy/sortOrder to UsersResults, defaulting sortBy to createdAt', async () => {
    renderPage(await UsersPage({ page: 1, limit: 20 }))

    expect(usersResultsSpy).toHaveBeenCalledWith(
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
      await UsersPage({ page: 1, limit: 20, search: 'alice', sortBy: 'name', sortOrder: 'desc' })
    )

    expect(usersResultsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'alice', sortBy: 'name', sortOrder: 'desc' })
    )
  })
})
