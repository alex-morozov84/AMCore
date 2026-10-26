import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import { AuthLocaleSwitcher } from './AuthLocaleSwitcher'

const replace = vi.hoisted(() => vi.fn())
vi.mock('client-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/mfa' }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('operation=demo&tag=a&tag=b'),
}))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ replace }),
}))

function renderSwitcher() {
  // No QueryClientProvider: an accidental product-profile hook must fail here.
  return render(
    <NextIntlClientProvider
      locale={DEFAULT_LOCALE}
      messages={{
        locale: {
          label: 'Language',
          en: 'English',
          ru: 'Russian',
        },
      }}
    >
      <AuthLocaleSwitcher />
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  replace.mockClear()
  window.history.replaceState({}, '', '/mfa#codes')
})

it('keeps an accessible name without visible labels or a product session', () => {
  renderSwitcher()
  expect(screen.getByRole('combobox', { name: 'Language' })).toHaveAccessibleName('Language')
  expect(screen.queryByText('Language')).not.toBeInTheDocument()
  expect(screen.queryByText('Changes immediately')).not.toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('switches immediately and keeps ordered duplicate parameters and hash', async () => {
  renderSwitcher()
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ru')
  expect(replace).toHaveBeenCalledExactlyOnceWith('/mfa?operation=demo&tag=a&tag=b#codes', {
    locale: 'ru',
  })
})

it('does not navigate when choosing the active locale', async () => {
  renderSwitcher()
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), DEFAULT_LOCALE)
  expect(replace).not.toHaveBeenCalled()
})
