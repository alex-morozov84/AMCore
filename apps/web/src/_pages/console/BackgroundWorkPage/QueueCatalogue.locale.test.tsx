import { NextIntlClientProvider } from 'next-intl'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import en from '../../../../messages/en.json'
import ru from '../../../../messages/ru.json'

import { availableQueue, summary } from './queue-fixtures'
import { queueMessages } from './queue-test-messages'
import { QueueSummaryLive } from './QueueSummaryLive'
import { useQueueSummary } from './use-queue-summary'

vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/features/console-background-work', () => ({ BackgroundWorkControls: () => null }))

vi.mock('./use-queue-summary', () => ({ useQueueSummary: vi.fn() }))

const RUSSIAN = 'ru'

const keys = (value: unknown, prefix = ''): string[] =>
  Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    typeof child === 'object' && child !== null
      ? keys(child, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  )

/**
 * Locale-coupled checks for the Background work copy. They need both real catalogues, so this file
 * is removed from a single-locale fork; the behaviour tests use the inlined English fixture.
 */
describe('Background work catalogue', () => {
  it('keeps the inlined summary fixture identical to its real catalogue keys', () => {
    const summaryCopy = Object.fromEntries(
      Object.entries(en.console.backgroundWork).filter(([key]) => key !== 'control')
    )
    expect(queueMessages.console.backgroundWork).toEqual(summaryCopy)
  })

  it('has the same keys in every locale', () => {
    expect(keys(ru.console.backgroundWork).sort()).toEqual(keys(en.console.backgroundWork).sort())
  })

  it('has copy for every stock queue and every kind', () => {
    for (const name of ['email', 'default', 'notifications', 'ai-runs']) {
      expect(en.console.backgroundWork.queues).toHaveProperty(name)
    }
    for (const kind of ['work', 'wake', 'extension']) {
      expect(en.console.backgroundWork.kinds).toHaveProperty(kind)
    }
  })

  it('uses ICU plurals for ages, with Russian few/many forms', () => {
    for (const unit of ['ageSeconds', 'ageMinutes', 'ageHours', 'ageDays'] as const) {
      expect(en.console.backgroundWork[unit]).toContain('plural')
      expect(ru.console.backgroundWork[unit]).toMatch(/few .* many .* other/)
    }
  })

  it('renders the Russian structure with Russian plural forms', () => {
    vi.mocked(useQueueSummary).mockReturnValue({
      data: summary([
        availableQueue('email', { age: { status: 'sample', seconds: 7300, sampled: 3 } }),
      ]),
      workRefreshed: false,
      works: undefined,
      workError: null,
      partial: false,
      denied: false,
      auto: true,
      setAuto: vi.fn(),
      online: true,
      isFetching: false,
      refreshFailed: false,
      canRefresh: true,
      retryAfterSeconds: 0,
      refresh: vi.fn(),
    })
    render(
      <NextIntlClientProvider locale={RUSSIAN} messages={ru}>
        <QueueSummaryLive initial={summary([])} initialUpdatedAt={0} />
      </NextIntlClientProvider>
    )
    expect(screen.getByRole('table', { name: 'Фоновые очереди' })).toBeInTheDocument()
    expect(screen.getAllByText('Не менее 2 часа').length).toBeGreaterThan(0)
  })
})
