import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  allUnavailableSummary,
  availableQueue,
  disabledQueue,
  mixedSummary,
  summary,
} from './queue-fixtures'
import { queueMessages } from './queue-test-messages'
import { QueueSummaryLive } from './QueueSummaryLive'
import { useQueueSummary } from './use-queue-summary'

vi.mock('./use-queue-summary', () => ({ useQueueSummary: vi.fn() }))

const setAuto = vi.fn()
const refresh = vi.fn()
function state(overrides: Partial<ReturnType<typeof useQueueSummary>> = {}) {
  vi.mocked(useQueueSummary).mockReturnValue({
    data: mixedSummary,
    denied: false,
    auto: true,
    setAuto,
    online: true,
    isFetching: false,
    refreshFailed: false,
    canRefresh: true,
    retryAfterSeconds: 0,
    refresh,
    ...overrides,
  })
}
function view(props: { boardOpenFailed?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={queueMessages}>
      <QueueSummaryLive initial={mixedSummary} initialUpdatedAt={0} {...props} />
    </NextIntlClientProvider>
  )
}
/** Desktop and mobile render the same rows; assert on the table, which assistive tech reads at md+. */
const table = () => screen.getByRole('table', { name: 'Background queues' })

beforeEach(() => {
  vi.clearAllMocks()
  state()
})

describe('rows', () => {
  it('shows human titles with the fixed technical name and purpose', () => {
    view()
    const rows = within(table()).getAllByRole('row')
    expect(rows).toHaveLength(5) // header + 4 queues
    expect(within(rows[1] as HTMLElement).getByText('Email')).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).getByText('email')).toBeInTheDocument()
    expect(screen.getAllByText(/Wake signals only/).length).toBeGreaterThan(0)
  })

  it('shows Waiting as waiting plus prioritized and a lower-bound age', () => {
    view()
    const email = within(table()).getAllByRole('row')[1] as HTMLElement
    const cells = within(email).getAllByRole('cell')
    expect(cells[2]).toHaveTextContent('14') // 12 waiting + 2 prioritized
    expect(cells[3]).toHaveTextContent('2')
    expect(cells[5]).toHaveTextContent('3')
    expect(cells[6]).toHaveTextContent('At least 4 minutes')
  })

  it('marks a paused queue and keeps its jobs counted as waiting', () => {
    view()
    const row = within(table()).getAllByRole('row')[3] as HTMLElement
    expect(within(row).getByText('Paused')).toBeInTheDocument()
    expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('140')
    expect(within(row).getByText(/not processed until the queue is resumed/)).toBeInTheDocument()
  })

  it('never turns an unreadable queue into zeros, and says it is not empty', () => {
    view()
    const row = within(table()).getAllByRole('row')[4] as HTMLElement
    expect(within(row).getByText('Unavailable')).toBeInTheDocument()
    expect(
      within(row).getByText('Could not be read. This is not an empty queue.')
    ).toBeInTheDocument()
    expect(
      within(row)
        .getAllByRole('cell')
        .slice(2)
        .map((c) => c.textContent)
    ).toEqual(['—', '—', '—', '—', '—'])
  })

  it('distinguishes empty from paused and unavailable, without claiming health', () => {
    view()
    const row = within(table()).getAllByRole('row')[2] as HTMLElement
    expect(within(row).getByText('Not paused')).toBeInTheDocument()
    expect(within(row).getByText('Empty')).toBeInTheDocument()
    expect(screen.queryByText(/healthy|running/i)).toBeNull()
  })

  it('renders a disabled queue and an unknown downstream queue by its kind', () => {
    state({
      data: summary([
        disabledQueue('default'),
        availableQueue('my-reports', { kind: 'extension' }),
        availableQueue('email', { age: { status: 'unknown' } }),
      ]),
    })
    view()
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Custom queue').length).toBeGreaterThan(0)
    expect(screen.getAllByText('my-reports').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0)
  })

  it("uses a downstream queue's own catalogue entry when one exists, and generic kind copy otherwise", () => {
    state({
      data: summary([
        availableQueue('my-reports', { kind: 'extension' }),
        availableQueue('my-exports', { kind: 'work' }),
      ]),
    })
    const messages = {
      console: {
        backgroundWork: {
          ...queueMessages.console.backgroundWork,
          queues: {
            ...queueMessages.console.backgroundWork.queues,
            'my-reports': { title: 'Reports', description: 'Builds the monthly reports.' },
          },
        },
      },
    }
    render(
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
        <QueueSummaryLive initial={mixedSummary} initialUpdatedAt={0} />
      </NextIntlClientProvider>
    )
    expect(screen.getAllByText('Reports').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Builds the monthly reports.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Work queue').length).toBeGreaterThan(0) // my-exports: generic by kind
    expect(screen.getAllByText('my-exports').length).toBeGreaterThan(0)
  })

  it('offers both the table and the mobile cards from one data set', () => {
    view()
    expect(screen.getAllByRole('list', { name: 'Background queues' })).toHaveLength(1)
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('explains an empty inventory', () => {
    state({ data: summary([]) })
    view()
    expect(screen.getByText('No queues are configured.')).toBeInTheDocument()
  })
})

describe('status line and degraded states', () => {
  it('shows when the snapshot was taken', () => {
    view()
    expect(screen.getByText(/Checked:/)).toBeInTheDocument()
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe(mixedSummary.checkedAt)
  })

  it('says unavailable is not empty once when every queue is unreadable', () => {
    state({ data: allUnavailableSummary })
    view()
    expect(screen.getByRole('status')).toHaveTextContent('Unavailable does not mean empty')
  })

  it('keeps older rows and says the last refresh failed instead of showing them as fresh', () => {
    state({ refreshFailed: true })
    view()
    expect(screen.getByRole('status')).toHaveTextContent('Showing data from')
    expect(screen.getByRole('status')).toHaveTextContent('The last refresh failed.')
    expect(screen.queryByText(/Checked:/)).toBeNull()
  })

  it('hides every row after access is lost', () => {
    state({ data: null, denied: true })
    view()
    expect(screen.getByText('Access changed. Verifying…')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('button', { name: /Refresh/ })).toBeNull()
  })
})

describe('controls', () => {
  it('toggles auto-refresh with aria-pressed and refreshes on demand', () => {
    view()
    const auto = screen.getByRole('button', { name: 'Auto-refresh: on' })
    expect(auto).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(auto)
    expect(setAuto).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('reflects a paused auto-refresh and a refresh in progress', () => {
    state({ auto: false, isFetching: true })
    view()
    expect(screen.getByRole('button', { name: 'Auto-refresh: paused' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    const busy = screen.getByRole('button', { name: 'Refreshing…' })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
  })

  it('disables manual refresh while offline and during a Retry-After', () => {
    state({ canRefresh: false, online: false })
    view()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    expect(screen.getByText('You are offline')).toBeInTheDocument()
  })

  it('tells how long a Retry-After blocks refreshing', () => {
    state({ canRefresh: false, retryAfterSeconds: 42 })
    view()
    expect(screen.getByText('Available in 42 seconds')).toBeInTheDocument()
  })
})

describe('queue board entry on the live summary', () => {
  const boardLinks = () => screen.queryAllByRole('link').map((link) => link.getAttribute('href'))

  it('shows the button and a deep link for every queue that is in the board, while it is available', () => {
    view()
    expect(screen.getByRole('link', { name: /Open queue board/ })).toHaveAttribute(
      'href',
      '/api/console/bull-board'
    )
    const rowLinks = within(table()).getAllByRole('link', { name: /Open in queue board/ })
    expect(rowLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/api/console/bull-board/queue/email',
      '/api/console/bull-board/queue/default',
      '/api/console/bull-board/queue/notifications',
      '/api/console/bull-board/queue/ai-runs',
    ])
  })

  it('shows the same row links in the mobile cards', () => {
    view()
    const cards = screen.getByRole('list', { name: 'Background queues' })
    expect(within(cards).getAllByRole('link', { name: /Open in queue board/ })).toHaveLength(4)
  })

  it('removes the button and every row link, and explains how to enable it, when the board is disabled', () => {
    state({ data: { ...mixedSummary, board: { state: 'disabled' } } })
    view()
    expect(boardLinks().filter((href) => href?.includes('bull-board'))).toEqual([])
    expect(screen.getByText('Queue board is not enabled')).toBeInTheDocument()
    expect(document.body.textContent).toContain('ENABLE_BULL_BOARD=true')
  })

  it('follows a restart of the API on the live page: available, disabled, available again', () => {
    const { rerender } = view()
    expect(screen.getByRole('link', { name: /Open queue board/ })).toBeInTheDocument()
    state({ data: { ...mixedSummary, board: { state: 'disabled' } } })
    rerender(
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={queueMessages}>
        <QueueSummaryLive initial={mixedSummary} initialUpdatedAt={0} />
      </NextIntlClientProvider>
    )
    expect(screen.queryByRole('link', { name: /Open queue board/ })).toBeNull()
    expect(screen.getByText('Queue board is not enabled')).toBeInTheDocument()
    state({ data: mixedSummary })
    rerender(
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={queueMessages}>
        <QueueSummaryLive initial={mixedSummary} initialUpdatedAt={0} />
      </NextIntlClientProvider>
    )
    expect(screen.getByRole('link', { name: /Open queue board/ })).toBeInTheDocument()
    expect(screen.queryByText('Queue board is not enabled')).toBeNull()
  })

  it('shows no board entry, never disabled or failed, while access is being re-verified', () => {
    state({ data: null as never, denied: true })
    view({ boardOpenFailed: true })
    expect(screen.queryByText('Queue board is not enabled')).toBeNull()
    expect(screen.queryByText('Could not open the queue board')).toBeNull()
    expect(boardLinks()).toEqual([])
  })

  it('shows the failed-open notice with the button when the board is available but the last attempt failed', () => {
    view({ boardOpenFailed: true })
    expect(screen.getByRole('status')).toHaveTextContent('Could not open the queue board')
    expect(screen.getByRole('link', { name: /Open queue board/ })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('ENABLE_BULL_BOARD')
  })

  it('lets the fresh disabled confirmation win over a failed-open marker', () => {
    state({ data: { ...mixedSummary, board: { state: 'disabled' } } })
    view({ boardOpenFailed: true })
    expect(screen.getByText('Queue board is not enabled')).toBeInTheDocument()
    expect(screen.queryByText('Could not open the queue board')).toBeNull()
  })

  it('does not turn a failed refresh into a board state: it keeps the last confirmed one', () => {
    state({ refreshFailed: true })
    view()
    expect(screen.getByRole('link', { name: /Open queue board/ })).toBeInTheDocument()
    expect(screen.queryByText('Queue board is not enabled')).toBeNull()
  })
})
