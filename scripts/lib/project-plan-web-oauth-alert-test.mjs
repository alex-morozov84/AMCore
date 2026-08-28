// init:project --mode=single: OAuthErrorAlert.test.tsx. Found via the real
// `pnpm --filter web build` in init-project.test.mjs — this fixture asserts
// actual translated text, not just key existence, so (unlike
// project-plan-web-i18n-fixtures.mjs's sibling) the kept locale determines
// which literal strings survive, not just which import does.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const BEFORE = `import { NextIntlClientProvider } from 'next-intl'
import { AuthErrorCode } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import en from '../../../../messages/en.json'
import ru from '../../../../messages/ru.json'

import { OAuthErrorAlert } from './OAuthErrorAlert'

const catalogues = { en, ru } as const

function renderAlert(code: string | string[] | undefined, locale: keyof typeof catalogues = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={catalogues[locale]}>
      <OAuthErrorAlert code={code} />
    </NextIntlClientProvider>
  )
}

describe('OAuthErrorAlert', () => {
  it('renders nothing when there is no code', () => {
    const { container } = renderAlert(undefined)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the localized message for a known oauth error code', () => {
    renderAlert(AuthErrorCode.OAUTH_TICKET_INVALID)

    expect(screen.getByText('The sign-in link expired. Please try again.')).toBeInTheDocument()
  })

  it('translates the same code into the active locale', () => {
    renderAlert(AuthErrorCode.OAUTH_TICKET_INVALID, 'ru')

    expect(screen.getByText('Ссылка для входа устарела. Попробуйте снова.')).toBeInTheDocument()
  })

  it('ignores an unrecognized code instead of showing a generic error banner', () => {
    const { container } = renderAlert('SOMETHING_MADE_UP_IN_THE_URL')
    expect(container).toBeEmptyDOMElement()
  })

  it('ignores a real, translated error code that is not OAuth-related', () => {
    // Not just "unknown" — INVALID_CREDENTIALS has a real translation in the
    // same \`errors\` catalogue, so a naive \`t.has()\` check would render it.
    const { container } = renderAlert(AuthErrorCode.INVALID_CREDENTIALS)
    expect(container).toBeEmptyDOMElement()
  })

  it('normalizes a repeated query param to its first value', () => {
    renderAlert([AuthErrorCode.OAUTH_TICKET_INVALID, 'SOME_OTHER_VALUE'])

    expect(screen.getByText('The sign-in link expired. Please try again.')).toBeInTheDocument()
  })

  it('ignores a repeated query param whose first value is not allowlisted', () => {
    const { container } = renderAlert(['SOME_OTHER_VALUE', AuthErrorCode.OAUTH_TICKET_INVALID])
    expect(container).toBeEmptyDOMElement()
  })
})
`

const TICKET_EXPIRED_TEXT = {
  en: 'The sign-in link expired. Please try again.',
  ru: 'Ссылка для входа устарела. Попробуйте снова.',
}

function after(locale) {
  const text = TICKET_EXPIRED_TEXT[locale]
  return `import { NextIntlClientProvider } from 'next-intl'
import { AuthErrorCode } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ${locale} from '../../../../messages/${locale}.json'

import { OAuthErrorAlert } from './OAuthErrorAlert'

const catalogues = { ${locale} } as const

function renderAlert(code: string | string[] | undefined, locale: keyof typeof catalogues = '${locale}') {
  return render(
    <NextIntlClientProvider locale={locale} messages={catalogues[locale]}>
      <OAuthErrorAlert code={code} />
    </NextIntlClientProvider>
  )
}

describe('OAuthErrorAlert', () => {
  it('renders nothing when there is no code', () => {
    const { container } = renderAlert(undefined)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the localized message for a known oauth error code', () => {
    renderAlert(AuthErrorCode.OAUTH_TICKET_INVALID)

    expect(screen.getByText('${text}')).toBeInTheDocument()
  })

  it('ignores an unrecognized code instead of showing a generic error banner', () => {
    const { container } = renderAlert('SOMETHING_MADE_UP_IN_THE_URL')
    expect(container).toBeEmptyDOMElement()
  })

  it('ignores a real, translated error code that is not OAuth-related', () => {
    // Not just "unknown" — INVALID_CREDENTIALS has a real translation in the
    // same \`errors\` catalogue, so a naive \`t.has()\` check would render it.
    const { container } = renderAlert(AuthErrorCode.INVALID_CREDENTIALS)
    expect(container).toBeEmptyDOMElement()
  })

  it('normalizes a repeated query param to its first value', () => {
    renderAlert([AuthErrorCode.OAUTH_TICKET_INVALID, 'SOME_OTHER_VALUE'])

    expect(screen.getByText('${text}')).toBeInTheDocument()
  })

  it('ignores a repeated query param whose first value is not allowlisted', () => {
    const { container } = renderAlert(['SOME_OTHER_VALUE', AuthErrorCode.OAUTH_TICKET_INVALID])
    expect(container).toBeEmptyDOMElement()
  })
})
`
}

export function buildWebOAuthAlertTestSteps(root, locale) {
  return [
    exactContentStep(
      path.join(root, 'apps/web/src/features/auth-oauth/ui/OAuthErrorAlert.test.tsx'),
      { expectedBefore: BEFORE, after: after(locale) },
      'OAuthErrorAlert.test.tsx: test only the kept locale, drop the cross-locale translation test'
    ),
  ]
}
