import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createTranslator, NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConsoleTimeZoneProvider } from '@/shared/lib/console-time-zone'

import { job, OBSERVED, sources } from './overview-problem-fixtures'
import type { OverviewSources } from './overview-problem-model'
import { overviewProblems } from './overview-problems'
import { OverviewProblems } from './OverviewProblems'
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
const messages = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../messages', `${DEFAULT_LOCALE}.json`), 'utf8')
)
const t = createTranslator({ locale: DEFAULT_LOCALE, messages, namespace: 'console.problems' })
function view(over: Partial<OverviewSources>, metrics: string | null = null) {
  const model = overviewProblems(sources(over), {
    t,
    locale: DEFAULT_LOCALE,
    name: (_kind, id) => id,
  })
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages} timeZone="UTC">
      <ConsoleTimeZoneProvider>
        <OverviewProblems model={model} t={t} metrics={metrics} newTabLabel="new tab" />
      </ConsoleTimeZoneProvider>
    </NextIntlClientProvider>
  )
}
describe('problem summary presentation', () => {
  it('limits initial attention to five groups and discloses the rest without an incident total', () => {
    view({
      scheduled: {
        checkedAt: OBSERVED,
        jobs: Array.from({ length: 7 }, (_, i) =>
          job({
            id: `job-${i}`,
            result: {
              state: 'failed',
              startedAt: OBSERVED,
              durationMs: 10,
              code: null,
              summary: null,
            },
          })
        ),
      },
    })
    const disclosure = screen.getByText(t('more', { count: 2 })).closest('details')!
    expect(disclosure).not.toHaveAttribute('open')
    expect(within(disclosure).getAllByRole('heading', { hidden: true })).toHaveLength(2)
    fireEvent.click(disclosure.querySelector('summary')!)
    expect(disclosure).toHaveAttribute('open')
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(7)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('groups gaps by source separately from attention, with an honest all-missing message', () => {
    view({ overview: null, queues: null, works: null, scheduled: null, integrations: null })
    expect(screen.getByText(t('unavailable'))).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: t('gaps') })).toBeInTheDocument()
    expect(screen.queryByText(t('empty'))).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: t('openSection') })).toHaveLength(5)
  })
  it('shows retained time, safe guide and optional metrics only when a time and dashboard exist', () => {
    view(
      {
        scheduled: {
          checkedAt: OBSERVED,
          jobs: [
            job({
              result: {
                state: 'failed',
                startedAt: OBSERVED,
                durationMs: 10,
                code: null,
                summary: null,
              },
            }),
          ],
        },
      },
      'https://metrics.example.test/d/demo'
    )
    expect(document.querySelector(`time[datetime="${OBSERVED}"]`)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: new RegExp(t('guide')) }).getAttribute('rel')).toBe(
      'noopener noreferrer'
    )
    const metrics = screen.getByRole('link', { name: new RegExp(t('metrics')) })
    expect(new URL(metrics.getAttribute('href')!).searchParams.get('from')).toBe(
      String(Date.parse(OBSERVED) - 900000)
    )
  })
})
