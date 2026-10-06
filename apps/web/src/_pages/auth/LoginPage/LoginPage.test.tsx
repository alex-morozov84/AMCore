import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LoginPage } from './LoginPage'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/features/auth-login', () => ({ LoginForm: () => <form aria-label="login form" /> }))
vi.mock('@/features/auth-register', () => ({
  RegisterForm: () => <form aria-label="register form" />,
}))
vi.mock('@/features/auth-oauth', () => ({
  OAuthErrorAlert: () => null,
  OAuthSection: () => <div data-testid="oauth" />,
}))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
afterEach(cleanup)

describe('public signup policy sign-in', () => {
  it.each([false, null])('keeps existing-account sign-in when signup policy is %s', (policy) => {
    render(<LoginPage oauthProviders={['google']} publicSignupEnabled={policy} />)
    expect(screen.getByRole('form', { name: 'login form' })).toBeInTheDocument()
    expect(screen.getByTestId('oauth')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'register' })).not.toBeInTheDocument()
  })
})
