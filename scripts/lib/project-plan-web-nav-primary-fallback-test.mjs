// init:project --mode=single: primary-unavailable-fallback.test.tsx. Added
// by P1 item 7 (server-rendered graceful degradation, ADR-079, PR #396)
// after this transform set was last updated -- same drift as its sibling
// component transform (project-plan-web-nav-primary-fallback.mjs). Mirrors
// project-plan-web-oauth-alert-test.mjs's approach: drop the cross-locale
// assertion entirely (it exists only to prove the OTHER locale renders,
// which is meaningless once only one locale ships) rather than
// mechanically keep a same-locale-twice test. The before text itself lives
// in project-plan-web-nav-primary-fallback-test-before.mjs for the same
// line-count reason.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'
import { PRIMARY_FALLBACK_TEST_BEFORE } from './project-plan-web-nav-primary-fallback-test-before.mjs'

const MESSAGE_TEXT = {
  en: 'This is temporarily unavailable. Please try again.',
  ru: 'Временно недоступно. Пожалуйста, попробуйте ещё раз.',
}

const RETRY_LABEL = { en: 'Retry', ru: 'Повторить' }

function after(locale) {
  const text = MESSAGE_TEXT[locale]
  const retry = RETRY_LABEL[locale]
  return `import { NextIntlClientProvider } from 'next-intl'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ${locale} from '../../../messages/${locale}.json'

import { PrimaryUnavailableFallback } from './primary-unavailable-fallback'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

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
  it('renders the localized temporarily-unavailable message and retry control', () => {
    renderFallback('upstream')

    expect(screen.getByText('${text}')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '${retry}' })).toBeInTheDocument()
  })

  it.each(['rate-limited', 'timeout', 'network', 'upstream'] as const)(
    'maps %s to approved generic copy without exposing the raw reason',
    (reason) => {
      const { container } = renderFallback(reason)

      expect(screen.getByText('${text}')).toBeInTheDocument()
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

export function buildWebNavPrimaryFallbackTestSteps(root, locale) {
  return [
    exactContentStep(
      path.join(root, 'apps/web/src/shared/ui/primary-unavailable-fallback.test.tsx'),
      { expectedBefore: PRIMARY_FALLBACK_TEST_BEFORE, after: after(locale) },
      'primary-unavailable-fallback.test.tsx: test only the kept locale, drop the cross-locale translation test'
    ),
  ]
}
