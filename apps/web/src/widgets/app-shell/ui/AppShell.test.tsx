import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AppShell } from './AppShell'

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))
vi.mock('@/features/auth-logout', () => ({ LogoutButton: () => null }))
vi.mock('@/features/locale-switcher', () => ({ LocaleSwitcher: () => null }))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: (props: React.ComponentProps<'a'>) => <a {...props}>{props.children}</a>,
}))

describe('product shell destinations', () => {
  it.each([undefined, '/crm'])(
    'aligns home while retaining independent Sessions %s',
    (homeHref) => {
      render(
        <AppShell homeHref={homeHref}>
          <p>Content</p>
        </AppShell>
      )
      expect(screen.getByRole('link', { name: 'nav.dashboard' })).toHaveAttribute(
        'href',
        homeHref ?? '/'
      )
      expect(screen.getByRole('link', { name: 'sessions.title' })).toHaveAttribute(
        'href',
        '/settings/sessions'
      )
    }
  )
})
