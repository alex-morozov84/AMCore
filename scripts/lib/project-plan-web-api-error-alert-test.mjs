// init:project --mode=single: api-error-alert.test.tsx. Found via the real
// `pnpm --filter web build` in init-project.test.mjs — see
// project-plan-web-oauth-alert-test.mjs's header for why this needs a
// locale-branched rewrite rather than a targeted patch.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const BEFORE = `import { NextIntlClientProvider } from 'next-intl'
import { AuthErrorCode } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
`

const INVALID_CREDENTIALS_TEXT = {
  en: 'Incorrect email or password.',
  ru: 'Неверный email или пароль.',
}
const UNKNOWN_ERROR_TEXT = {
  en: 'Something went wrong. Please try again.',
  ru: 'Что-то пошло не так. Попробуйте снова.',
}
const CORRELATION_HINT_TEXT = { en: 'Reference: abc-123', ru: 'Идентификатор запроса: abc-123' }
const NETWORK_ERROR_TEXT = {
  en: "Can't reach the server. Check your connection and try again.",
  ru: 'Не удаётся связаться с сервером. Проверьте соединение и попробуйте снова.',
}

function after(locale) {
  return `import { NextIntlClientProvider } from 'next-intl'
import { AuthErrorCode } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ${locale} from '../../../messages/${locale}.json'
import { ApiNetworkError, ApiRequestError } from '../api/http-client'

import { ApiErrorAlert } from './api-error-alert'

const catalogues = { ${locale} } as const

function apiError(body: Record<string, unknown>, status = 400) {
  return new ApiRequestError(status, body as never)
}

function renderAlert(error: unknown, locale: keyof typeof catalogues = '${locale}') {
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

    expect(screen.getByText('${INVALID_CREDENTIALS_TEXT[locale]}')).toBeInTheDocument()
    // The backend's own English prose is developer-facing and must never reach
    // the user — this is the defect ADR-023 exists to prevent.
    expect(screen.queryByText(/Invalid credentials/)).not.toBeInTheDocument()
  })

  it('falls back to a generic message and shows the correlation ID for an unknown code', () => {
    renderAlert(
      apiError({
        message: 'Some internal detail',
        errorCode: 'SOMETHING_THE_CLIENT_HAS_NEVER_HEARD_OF',
        correlationId: 'abc-123',
      })
    )

    expect(screen.getByText('${UNKNOWN_ERROR_TEXT[locale]}')).toBeInTheDocument()
    expect(screen.getByText('${CORRELATION_HINT_TEXT[locale]}')).toBeInTheDocument()
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

    expect(screen.getByText("${NETWORK_ERROR_TEXT[locale]}")).toBeInTheDocument()
  })

  it('falls back generically for a non-fetch-client throw', () => {
    renderAlert(new Error('boom'))

    expect(screen.getByText('${UNKNOWN_ERROR_TEXT[locale]}')).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
  })
})
`
}

export function buildWebApiErrorAlertTestSteps(root, locale) {
  return [
    exactContentStep(
      path.join(root, 'apps/web/src/shared/ui/api-error-alert.test.tsx'),
      { expectedBefore: BEFORE, after: after(locale) },
      'api-error-alert.test.tsx: test only the kept locale, drop the cross-locale translation test'
    ),
  ]
}
