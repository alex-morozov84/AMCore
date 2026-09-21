import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { getConsoleUsersHref } from '@/shared/lib/console-public-href'

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

it('offers a progress-aware return to the first Users page', async () => {
  const page = await UsersOutOfRange({ totalPages: 2 })
  render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      {page}
    </NextIntlClientProvider>
  )
  expect(screen.getByText('This page is unavailable')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Go to first page' })).toHaveAttribute(
    'href',
    getConsoleUsersHref()
  )
})
