import { createTranslator } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import en from '../../../../messages/en.json'
import ru from '../../../../messages/ru.json'

import { UserLoginFacts } from './UserLoginFacts'
import { UserSecurityEvents } from './UserSecurityEvents'

const catalogues = { en, ru }
const locales = Object.keys(catalogues) as (keyof typeof catalogues)[]

vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({
    href,
    children,
    prefetch,
  }: {
    href: string
    children: React.ReactNode
    prefetch: boolean
  }) => (
    <a href={href} data-prefetch={String(prefetch)}>
      {children}
    </a>
  ),
}))

function translations(locale: keyof typeof catalogues) {
  const messages = catalogues[locale]
  vi.mocked(getTranslations).mockResolvedValue(
    createTranslator({ locale, messages, namespace: 'console.detail.login' }) as never
  )
  return messages.console.detail.login
}

describe('human-readable user sign-in setup', () => {
  it.each(locales)('shows a neutral no-methods account with visible help in %s', async (locale) => {
    const copy = translations(locale)
    render(await UserLoginFacts({ diagnostics: { hasPassword: false, linkedProviders: [] } }))
    expect(screen.getByText(copy.notConfigured)).toBeVisible()
    expect(screen.getByText(copy.noLinkedAccounts)).toBeVisible()
    expect(screen.getByText(copy.passwordHelp)).toBeVisible()
    expect(screen.getByText(copy.linkedAccountsHelp)).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each(locales)(
    'renders all provider names without credentials or a login claim in %s',
    async (locale) => {
      const copy = translations(locale)
      const { container } = render(
        await UserLoginFacts({
          diagnostics: {
            hasPassword: true,
            linkedProviders: ['google', 'github', 'apple', 'telegram'],
          },
        })
      )
      expect(screen.getByText('Google, GitHub, Apple, Telegram')).toBeVisible()
      expect(screen.getByText(copy.configured)).toBeVisible()
      expect(screen.queryByText(copy.passwordHelp)).not.toBeInTheDocument()
      expect(container.innerHTML).not.toMatch(/passwordHash|accessToken|providerAccountId/)
    }
  )

  it.each(locales)(
    'explains each security link and avoids audit prefetch in %s',
    async (locale) => {
      const copy = translations(locale)
      render(await UserSecurityEvents({ userId: 'target' }))
      expect(screen.getByRole('heading', { name: copy.securityEvents })).toBeVisible()
      for (const [name, help] of [
        [copy.confirmations, copy.confirmationsHelp],
        [copy.access, copy.accessHelp],
      ]) {
        expect(screen.getByRole('link', { name })).toHaveAttribute('data-prefetch', 'false')
        expect(screen.getByText(help)).toBeVisible()
      }
      expect(screen.getByText(copy.historyHelp)).toBeVisible()
    }
  )
})
