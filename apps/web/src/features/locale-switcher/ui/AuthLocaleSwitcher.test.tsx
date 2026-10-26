import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { AuthLocaleSwitcher } from './AuthLocaleSwitcher'

const replace = vi.hoisted(() => vi.fn())
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/mfa' }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('operation=demo') }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ replace }),
}))

it('changes only URL language without requiring a product-session Query provider', async () => {
  // No QueryClientProvider: a product-profile hook here would throw before the control renders.
  render(
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
  expect(screen.getByRole('combobox', { name: 'Language' })).toBeVisible()
  expect(replace).not.toHaveBeenCalled()
})
