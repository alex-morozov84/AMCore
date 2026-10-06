import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RegisterPage } from './RegisterPage'

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

describe('public signup policy registration', () => {
  it.each([false, null])('contains public registration when signup policy is %s', (policy) => {
    render(<RegisterPage oauthProviders={['google']} publicSignupEnabled={policy} />)
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('oauth')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      policy === false ? 'publicSignupClosed' : 'signupPolicyUnavailable'
    )
    expect(screen.getByRole('link', { name: 'login' })).toHaveAttribute('href', '/login')
  })

  it('offers enabled registration and provider choices', () => {
    render(<RegisterPage oauthProviders={['google']} publicSignupEnabled />)
    expect(screen.getByRole('form', { name: 'register form' })).toBeInTheDocument()
    expect(screen.getByTestId('oauth')).toBeInTheDocument()
  })
})
