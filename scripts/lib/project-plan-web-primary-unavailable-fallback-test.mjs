// init:project --mode=single: primary-unavailable-fallback.test.tsx. Found
// via the real `pnpm --filter web test` in init-project.test.mjs (same
// discovery path as project-plan-web-oauth-alert-test.mjs's three
// siblings) -- this fixture asserts actual translated text, not just key
// existence, so the kept locale determines which literal strings survive,
// not just which import does. Missed when this file was first migrated to
// useRouteProgressRouter() (P1 item 8): that change only touched its
// mocked hook import, not this locale-coverage gap. Both locale variants
// verified empirically (real eslint --fix + prettier + vitest run against
// a disposable copy at the real path), not guessed.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const BEFORE = `import { NextIntlClientProvider } from 'next-intl'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '../../../messages/en.json'
import ru from '../../../messages/ru.json'

import { PrimaryUnavailableFallback } from './primary-unavailable-fallback'

const refresh = vi.fn()

vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh }),
}))

const catalogues = { en, ru } as const

function renderFallback(
  reason: 'rate-limited' | 'timeout' | 'network' | 'upstream' = 'upstream',
  locale: keyof typeof catalogues = 'en'
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={catalogues[locale]}>
      <PrimaryUnavailableFallback reason={reason} />
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PrimaryUnavailableFallback', () => {
  it('renders the localized temporarily-unavailable message and retry control (en)', () => {
    renderFallback('upstream', 'en')

    expect(
      screen.getByText('This is temporarily unavailable. Please try again.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('renders the localized message in ru', () => {
    renderFallback('upstream', 'ru')

    expect(
      screen.getByText('Временно недоступно. Пожалуйста, попробуйте ещё раз.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })

  it.each(['rate-limited', 'timeout', 'network', 'upstream'] as const)(
    'maps %s to approved generic copy without exposing the raw reason',
    (reason) => {
      const { container } = renderFallback(reason)

      expect(
        screen.getByText('This is temporarily unavailable. Please try again.')
      ).toBeInTheDocument()
      expect(container.innerHTML).not.toContain(reason)
    }
  )

  it('calls router.refresh() when retry is clicked, not any other recovery mechanism', async () => {
    const user = userEvent.setup()
    renderFallback()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
`

const UNAVAILABLE_TEXT = {
  en: 'This is temporarily unavailable. Please try again.',
  ru: 'Временно недоступно. Пожалуйста, попробуйте ещё раз.',
}
const RETRY_TEXT = { en: 'Retry', ru: 'Повторить' }

function after(locale) {
  const unavailable = UNAVAILABLE_TEXT[locale]
  const retry = RETRY_TEXT[locale]
  return `import { NextIntlClientProvider } from 'next-intl'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ${locale} from '../../../messages/${locale}.json'

import { PrimaryUnavailableFallback } from './primary-unavailable-fallback'

const refresh = vi.fn()

vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh }),
}))

const catalogues = { ${locale} } as const

function renderFallback(
  reason: 'rate-limited' | 'timeout' | 'network' | 'upstream' = 'upstream',
  locale: keyof typeof catalogues = '${locale}'
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={catalogues[locale]}>
      <PrimaryUnavailableFallback reason={reason} />
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PrimaryUnavailableFallback', () => {
  it('renders the localized temporarily-unavailable message and retry control (${locale})', () => {
    renderFallback('upstream', '${locale}')

    expect(
      screen.getByText('${unavailable}')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '${retry}' })).toBeInTheDocument()
  })

  it.each(['rate-limited', 'timeout', 'network', 'upstream'] as const)(
    'maps %s to approved generic copy without exposing the raw reason',
    (reason) => {
      const { container } = renderFallback(reason)

      expect(
        screen.getByText('${unavailable}')
      ).toBeInTheDocument()
      expect(container.innerHTML).not.toContain(reason)
    }
  )

  it('calls router.refresh() when retry is clicked, not any other recovery mechanism', async () => {
    const user = userEvent.setup()
    renderFallback()

    await user.click(screen.getByRole('button', { name: '${retry}' }))

    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
`
}

export function buildWebPrimaryUnavailableFallbackTestSteps(root, locale) {
  return [
    exactContentStep(
      path.join(root, 'apps/web/src/shared/ui/primary-unavailable-fallback.test.tsx'),
      { expectedBefore: BEFORE, after: after(locale) },
      'primary-unavailable-fallback.test.tsx: test only the kept locale, drop the cross-locale translation test'
    ),
  ]
}
