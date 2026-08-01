import { NextIntlClientProvider } from 'next-intl'
import { AuthErrorCode } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'

import en from '../../../messages/en.json'
import ru from '../../../messages/ru.json'

import { ApiErrorAlert } from './api-error-alert'

const catalogues = { en, ru } as const

/** Minimal Axios error carrying an AMCore error envelope. */
function apiError(body: Record<string, unknown>, status = 400) {
  const error = new AxiosError('Request failed')
  error.response = {
    data: body,
    status,
    statusText: '',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  }
  return error
}

function renderAlert(error: unknown, locale: keyof typeof catalogues = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={catalogues[locale]}>
      <ApiErrorAlert error={error} />
    </NextIntlClientProvider>
  )
}

describe('ApiErrorAlert', () => {
  it('renders nothing when there is no error', () => {
    const { container } = renderAlert(null)
    expect(container).toBeEmptyDOMElement()
  })

  it('translates a backend error code rather than showing the backend message', () => {
    renderAlert(
      apiError({
        message: 'Invalid credentials',
        errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      })
    )

    expect(screen.getByText('Incorrect email or password.')).toBeInTheDocument()
    // The backend's own English prose is developer-facing and must never reach
    // the user — this is the defect ADR-023 exists to prevent.
    expect(screen.queryByText(/Invalid credentials/)).not.toBeInTheDocument()
  })

  it('translates the same code into the active locale', () => {
    renderAlert(
      apiError({ message: 'Invalid credentials', errorCode: AuthErrorCode.INVALID_CREDENTIALS }),
      'ru'
    )

    expect(screen.getByText('Неверный email или пароль.')).toBeInTheDocument()
  })

  it('falls back to a generic message and shows the correlation ID for an unknown code', () => {
    renderAlert(
      apiError({
        message: 'Some internal detail',
        errorCode: 'SOMETHING_THE_CLIENT_HAS_NEVER_HEARD_OF',
        correlationId: 'abc-123',
      })
    )

    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.getByText('Reference: abc-123')).toBeInTheDocument()
    expect(screen.queryByText(/Some internal detail/)).not.toBeInTheDocument()
  })

  it('does not show a correlation ID when the code was understood', () => {
    renderAlert(
      apiError({
        message: 'Invalid credentials',
        errorCode: AuthErrorCode.INVALID_CREDENTIALS,
        correlationId: 'abc-123',
      })
    )

    expect(screen.queryByText(/abc-123/)).not.toBeInTheDocument()
  })

  it('maps a network failure to its own code', () => {
    const error = new AxiosError('Network Error')
    error.code = 'ERR_NETWORK'

    renderAlert(error)

    expect(
      screen.getByText("Can't reach the server. Check your connection and try again.")
    ).toBeInTheDocument()
  })

  it('maps a timeout to its own code', () => {
    const error = new AxiosError('timeout exceeded')
    error.code = 'ECONNABORTED'

    renderAlert(error)

    expect(screen.getByText('The request took too long. Please try again.')).toBeInTheDocument()
  })

  it('falls back generically for a non-Axios throw', () => {
    renderAlert(new Error('boom'))

    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
  })
})
