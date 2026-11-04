import { NextIntlClientProvider } from 'next-intl'
import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

vi.mock('client-only', () => ({}))
vi.mock('@amcore/shared', async (importOriginal: () => Promise<object>) => ({
  ...(await importOriginal()),
  SERVED_LOCALES: ['en'],
}))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/login' }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ replace: vi.fn() }),
}))

it('renders nothing when the build serves one locale', async () => {
  const { AuthLocaleSwitcher } = await import('./AuthLocaleSwitcher')
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={{ locale: { label: 'Language', en: 'English' } }}>
      <AuthLocaleSwitcher />
    </NextIntlClientProvider>
  )
  expect(container).toBeEmptyDOMElement()
})
