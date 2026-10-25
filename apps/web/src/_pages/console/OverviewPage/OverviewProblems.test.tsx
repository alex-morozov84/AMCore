import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createTranslator, NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@amcore/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConsoleTimeZoneProvider } from '@/shared/lib/console-time-zone'

import { fileConflictSources, job, OBSERVED, sources } from './overview-problem-fixtures'
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
function view(
  over: Partial<OverviewSources>,
  metrics: string | null = null,
  locale = DEFAULT_LOCALE
) {
  const messages = JSON.parse(
    readFileSync(resolve(__dirname, '../../../../messages', `${locale}.json`), 'utf8')
  )
  const t = createTranslator({ locale, messages, namespace: 'console.problems' })
  const model = overviewProblems(sources(over), {
    t,
    locale,
    name: (_kind, id) => id,
  })
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
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

describe('C1 visible private-file observations', () => {
  it.each(
    SUPPORTED_LOCALES.flatMap((locale) =>
      [false, true].map((primaryFailed) => ({ locale, primaryFailed }))
    )
  )(
    '$locale: preserves two named results and labels only the secondary as old ($primaryFailed)',
    ({ locale, primaryFailed }) => {
      const messages = JSON.parse(
        readFileSync(resolve(__dirname, '../../../../messages', `${locale}.json`), 'utf8')
      )
      const copy = createTranslator({ locale, messages, namespace: 'console.problems' })
      const { container } = view(fileConflictSources(primaryFailed), null, locale)
      const primary = copy('fileOverviewResult', {
        result: copy(primaryFailed ? 'privateFailed' : 'privatePassed'),
      })
      const secondary =
        copy('fileIntegrationResult', {
          result: copy(primaryFailed ? 'privatePassed' : 'privateFailed'),
        }) +
        ' ' +
        copy('old')
      expect(screen.getByText(primary, { exact: true })).toBeInTheDocument()
      expect(screen.getByText(secondary, { exact: true })).toBeInTheDocument()
      expect(container.querySelectorAll('li')).toHaveLength(1)
      for (const stamp of ['2026-10-25T12:10:00.000Z', '2026-10-24T12:00:00.000Z'])
        expect(container.querySelectorAll(`time[datetime="${stamp}"]`)).toHaveLength(1)
      expect(screen.getByRole('link', { name: copy('openFiles') })).toHaveAttribute(
        'href',
        expect.stringContaining('#overview-files')
      )
    }
  )
})
