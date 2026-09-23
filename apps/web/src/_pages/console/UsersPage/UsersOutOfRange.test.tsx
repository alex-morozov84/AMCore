import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  usePathname: () => '/admin/users',
}))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string, values?: Record<string, number>) => {
    if (key === 'usersPageOutOfRangeDescription')
      return `Choose a page between 1 and ${values?.totalPages}.`
    return messages.console[key as keyof typeof messages.console] ?? key
  }),
}))

import { UsersOutOfRange } from './UsersOutOfRange'

const messages = {
  console: {
    usersPageOutOfRangeTitle: 'This page is unavailable',
    usersPageOutOfRangeDescription: 'Choose a page.',
    usersPageOutOfRangeAction: 'Go to first page',
  },
}

function renderOutOfRange(page: Awaited<ReturnType<typeof UsersOutOfRange>>) {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      {page}
    </NextIntlClientProvider>
  )
}

describe('UsersOutOfRange', () => {
  it('offers a progress-aware return to page 1, carrying the current sort forward', async () => {
    const page = await UsersOutOfRange({
      totalPages: 2,
      baseHref: '/en/admin/users',
      sortBy: 'createdAt',
    })
    renderOutOfRange(page)

    expect(screen.getByText('This page is unavailable')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to first page' })).toHaveAttribute(
      'href',
      '/en/admin/users?sortBy=createdAt'
    )
  })

  it('preserves the current search and sortOrder in the recovery link', async () => {
    const page = await UsersOutOfRange({
      totalPages: 2,
      baseHref: '/en/admin/users',
      search: 'alice',
      sortBy: 'name',
      sortOrder: 'desc',
    })
    renderOutOfRange(page)

    expect(screen.getByRole('link', { name: 'Go to first page' })).toHaveAttribute(
      'href',
      '/en/admin/users?search=alice&sortBy=name&sortOrder=desc'
    )
  })
})
