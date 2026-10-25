import { NextIntlClientProvider } from 'next-intl'
import { AuthErrorCode } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authApi } from '@/shared/api/auth-api'
import { ApiNetworkError, ApiRequestError } from '@/shared/api/http-client'

import enMessages from '../../../../messages/en.json'
import ruMessages from '../../../../messages/ru.json'

import { RegisterForm } from './RegisterForm'

vi.mock('@/shared/api/auth-api', () => ({ authApi: { register: vi.fn() } }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

const failure = (status: number, errorCode?: string) =>
  new ApiRequestError(status, {
    statusCode: status,
    message: 'x',
    errorCode,
    timestamp: new Date(0).toISOString(),
    path: '/api/auth/register',
    method: 'POST',
  } as never)

function renderForm(locale: 'en' | 'ru' = 'en') {
  const messages = locale === 'en' ? enMessages : ruMessages
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <QueryClientProvider client={client}>
        <RegisterForm />
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
}

async function submitValidForm(locale: 'en' | 'ru' = 'en') {
  const t = (locale === 'en' ? enMessages : ruMessages).auth
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(t.name), 'Jane Doe')
  await user.type(screen.getByLabelText(t.email), 'jane@example.com')
  await user.type(screen.getByLabelText(t.password, { exact: true }), 'Correct1Horse')
  await user.click(screen.getByRole('button', { name: t.register }))
}

/** Rejects after the caller has attached its handler, as a real network failure does. */
function rejectRegister(error: unknown) {
  vi.mocked(authApi.register).mockImplementation(
    () => new Promise((_resolve, reject) => setTimeout(() => reject(error), 0))
  )
}

beforeEach(() => {
  vi.mocked(authApi.register).mockReset()
})
afterEach(cleanup)

describe('RegisterForm after a failed registration', () => {
  it.each(['en', 'ru'] as const)(
    'shows one created-account notice, locks the form and offers sign-in (%s)',
    async (locale) => {
      const messages = locale === 'en' ? enMessages : ruMessages
      rejectRegister(failure(503, AuthErrorCode.REGISTRATION_SIGN_IN_REQUIRED))
      renderForm(locale)
      await submitValidForm(locale)

      const notice = await screen.findByRole('status')
      expect(notice).toHaveTextContent(messages.errors.REGISTRATION_SIGN_IN_REQUIRED)
      expect(notice).toHaveFocus()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByLabelText(messages.auth.password, { exact: true })).toHaveValue('')
      expect(screen.getByLabelText(messages.auth.password, { exact: true })).toBeDisabled()
      expect(screen.getByLabelText(messages.auth.email)).toBeDisabled()
      expect(screen.queryByRole('button', { name: messages.auth.register })).not.toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: messages.auth.registrationCreatedLink })
      ).toHaveAttribute('href', '/login')
      expect(authApi.register).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(messages.auth.registrationUnknownHelp)).not.toBeInTheDocument()
    }
  )

  it.each([
    ['a server error', failure(500)],
    ['an unavailable backend', failure(503)],
    ['a lost connection', new ApiNetworkError(new TypeError('Failed to fetch'))],
  ])('keeps the form usable and adds neutral help after %s', async (_label, error) => {
    rejectRegister(error)
    renderForm()
    await submitValidForm()

    expect(await screen.findByText(enMessages.auth.registrationUnknownHelp)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(enMessages.errors.REGISTRATION_SIGN_IN_REQUIRED)).toBeNull()
    expect(screen.getByRole('button', { name: enMessages.auth.register })).toBeEnabled()
  })

  it('never claims creation for an existing email', async () => {
    rejectRegister(failure(409, AuthErrorCode.EMAIL_ALREADY_EXISTS))
    renderForm()
    await submitValidForm()

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(enMessages.errors.EMAIL_ALREADY_EXISTS)
    )
    expect(screen.queryByText(enMessages.auth.registrationUnknownHelp)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
