import { NextIntlClientProvider } from 'next-intl'
import type { SupportMailFact, SupportMailReceipt } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import en from '../../../../messages/en.json'
import ru from '../../../../messages/ru.json'

import { SupportMailDialog } from './SupportMailDialog'

vi.mock('@/shared/ui/console-detail/ConsoleTimestamp', () => ({
  ConsoleTimestamp: ({ value }: { value: string }) => <time>{value}</time>,
}))
const catalogues = { en, ru }
const locales = Object.keys(catalogues) as (keyof typeof catalogues)[]
const fact: SupportMailFact = {
  evidence: 'stored',
  attemptId: '00000000-0000-4000-8000-000000000001',
  kind: 'password_recovery',
  outcome: 'not_started',
  tokenIssued: true,
  provider: 'mock',
  reason: 'render_failed',
  attemptedAt: '2026-10-24T12:00:00.000Z',
  settledAt: '2026-10-24T12:00:01.000Z',
  readUntil: '2026-10-25T12:00:00.000Z',
}
function show(locale: keyof typeof catalogues, receipt: SupportMailReceipt) {
  render(
    <NextIntlClientProvider locale={locale} messages={catalogues[locale]}>
      <SupportMailDialog
        phase={{ kind: 'result', mailKind: 'password_recovery', receipt }}
        onClose={vi.fn()}
        onCheck={vi.fn()}
        finalFocus={() => null}
      />
    </NextIntlClientProvider>
  )
  return catalogues[locale].console.supportMail
}

describe('understandable saved mail result', () => {
  it.each(locales)('states the known failure, cancellation and next step once in %s', (locale) => {
    const copy = show(locale, fact)
    expect(screen.getByRole('heading', { name: copy.outcomeTitle.not_started })).toBeVisible()
    expect(screen.getAllByText(copy.reason.render_failed)).toHaveLength(1)
    expect(
      screen.getByText(`${copy.password_recovery.replaced} ${copy.next.not_started}`)
    ).toBeVisible()
    expect(screen.getByText(copy.password_recovery.title)).toBeVisible()
    expect(screen.queryByText(/If a new link|Если новая ссылка/)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/This result describes|Этот результат описывает/)
    ).not.toBeInTheDocument()
  })

  it('does not claim link cancellation when no token was issued', () => {
    const copy = show('en', { ...fact, tokenIssued: false })
    expect(
      screen.queryByText(copy.password_recovery.replaced, { exact: false })
    ).not.toBeInTheDocument()
    expect(screen.getByText(copy.next.not_started)).toBeVisible()
  })

  it('preserves uncertainty and a read-only check when the receipt cannot be read', () => {
    const copy = show('en', { evidence: 'unconfirmed', attemptId: fact.attemptId })
    expect(screen.getByRole('heading', { name: copy.outcomeTitle.unknown })).toBeVisible()
    expect(screen.getByText(copy.detail.unknown)).toBeVisible()
    expect(screen.getByText(copy.linkMayBeReplaced)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.check })).toBeEnabled()
    expect(screen.queryByText(copy.outcomeTitle.not_started)).not.toBeInTheDocument()
  })
})
