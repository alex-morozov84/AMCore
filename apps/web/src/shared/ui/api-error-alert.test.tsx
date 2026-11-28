import { NextIntlClientProvider } from 'next-intl'
import { AuthErrorCode } from '@amcore/shared'
import { cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import en from '../../../messages/en.json'
import ru from '../../../messages/ru.json'
import { ApiNetworkError, ApiRequestError } from '../api/http-client'

import { ApiErrorAlert } from './api-error-alert'

const catalogues = { en, ru } as const

function apiError(body: Record<string, unknown>, status = 400) {
  return new ApiRequestError(status, body as never)
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
    renderAlert(new ApiNetworkError(new TypeError('Failed to fetch')))

    expect(
      screen.getByText("Can't reach the server. Check your connection and try again.")
    ).toBeInTheDocument()
  })

  it('falls back generically for a non-fetch-client throw', () => {
    renderAlert(new Error('boom'))

    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
  })
})

function showRateLimit(error: ApiRequestError) {
  renderAlert(error)
  return screen.getByRole('alert')
}

it.each([undefined, 0, NaN])('explains a bare 429 without a usable delay (%s)', (delay) => {
  expect(showRateLimit(new ApiRequestError(429, undefined, delay)).textContent).toBe(
    'Too many requests.'
  )
})

it('shows the duration and preserves the support reference for an unknown 429 code', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const alert = showRateLimit(
      new ApiRequestError(
        429,
        {
          statusCode: 429,
          timestamp: '2026-01-01T00:00:00Z',
          path: '/api/test',
          method: 'POST',
          message: 'Raw backend prose',
          errorCode: 'FUTURE_CODE',
          correlationId: 'test-ref',
        },
        7
      )
    )
    expect(alert).toHaveTextContent('Too many requests. The server asks you to wait 7 seconds.')
    expect(alert).toHaveTextContent('test-ref')
    expect(alert).not.toHaveTextContent('Raw backend prose')
  } finally {
    warn.mockRestore()
  }
})

it('keeps a specific 429 message with the duration and omits the duration on 503', () => {
  const body = {
    statusCode: 429,
    timestamp: '2026-01-01T00:00:00Z',
    path: '/api/test',
    method: 'POST',
    message: 'Raw backend prose',
    errorCode: 'INTEGRATION_PROBE_COOLDOWN',
  }
  const alert = showRateLimit(new ApiRequestError(429, body, 7))
  expect(alert).toHaveTextContent(en.errors.INTEGRATION_PROBE_COOLDOWN)
  expect(alert).toHaveTextContent('7 seconds')

  cleanup()
  const other = showRateLimit(new ApiRequestError(503, { ...body, statusCode: 503 }, 7))
  expect(other).not.toHaveTextContent('7 seconds')
})
