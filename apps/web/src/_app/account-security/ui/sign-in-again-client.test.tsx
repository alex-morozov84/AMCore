import { NextIntlClientProvider } from 'next-intl'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type * as AuthActions from '@/shared/api/auth-api'
import { ApiRequestError } from '@/shared/api/http-client'

const mocks = vi.hoisted(() => ({ login: vi.fn(), replace: vi.fn() }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ replace: mocks.replace }),
}))
vi.mock('@/shared/api/auth-api', async (original) => ({
  ...(await original<typeof AuthActions>()),
  authActions: () => ({ login: mocks.login }),
}))
vi.mock('@/features/auth-login', () => ({
  LoginForm: ({ adapter }: { adapter: { submit: (input: unknown) => Promise<unknown> } }) => (
    <button
      onClick={() =>
        void adapter
          .submit({ email: 'fixture@example.test', password: '<fake-password>' })
          .catch(() => {})
      }
    >
      Submit fixture
    </button>
  ),
}))
vi.mock('@/shared/ui/route-progress-link', () => ({ RouteProgressLink: () => null }))

import { SignInAgainClient } from './sign-in-again-client'

it('offers an explicit fresh Console entry after an unknown logout without replaying credentials', async () => {
  mocks.login.mockRejectedValue(
    new ApiRequestError(401, {
      statusCode: 401,
      message: 'changed',
      errorCode: 'AUTH_CONTEXT_CHANGED',
      timestamp: '',
      path: '',
      method: '',
    })
  )
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        auth: {
          logoutReturnUnknown: 'Sign-out result is unknown',
          freshConsoleSignIn: 'Start a new sign-in',
        },
      }}
    >
      <SignInAgainClient
        placement={{
          apiBase: '/auth',
          mfaHref: '/mfa',
          destination: '/admin',
          entryKind: 'console',
          freshEntryHref: '/admin/sign-in-again',
        }}
        entryId={crypto.randomUUID()}
        returnEntryId={crypto.randomUUID()}
        locale="en"
      />
    </NextIntlClientProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Submit fixture' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Sign-out result is unknown')
  expect(mocks.replace).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Start a new sign-in' }))
  const target = new URL(mocks.replace.mock.calls[0]![0], 'https://app.example.test')
  expect(target.pathname).toBe('/admin/sign-in-again')
  expect([...target.searchParams.keys()]).toEqual(['entryId'])
  expect(mocks.login).toHaveBeenCalledTimes(1)
})
