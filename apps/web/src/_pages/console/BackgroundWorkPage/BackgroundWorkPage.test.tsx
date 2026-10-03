import { NextIntlClientProvider } from 'next-intl'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchConsoleQueues } from '@/shared/api/console/queues'
import { BackendRequestError } from '@/shared/api/server/errors'

import { BackgroundWorkPage } from './BackgroundWorkPage'
import { mixedSummary } from './queue-fixtures'
import { queueMessages } from './queue-test-messages'

vi.mock('server-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin' }))
vi.mock('@/shared/api/console/queues', () => ({ fetchConsoleQueues: vi.fn() }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/shared/api/console-api', () => ({ consoleApi: { getBackgroundWorkQueues: vi.fn() } }))
vi.mock('./QueueSummaryLive', () => ({
  QueueSummaryLive: ({ initial }: { initial: { checkedAt: string } }) => (
    <p>live {initial.checkedAt}</p>
  ),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => {
    const messages = queueMessages.console.backgroundWork as unknown as Record<string, string>
    return (key: string) => messages[key] ?? key
  },
}))

async function view() {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        ...queueMessages,
        common: {
          temporarilyUnavailable: 'This is temporarily unavailable. Please try again.',
          retry: 'Try again',
        },
      }}
    >
      {await BackgroundWorkPage()}
    </NextIntlClientProvider>
  )
}

beforeEach(() => vi.clearAllMocks())

describe('BackgroundWorkPage', () => {
  it('renders the static heading and hands the first snapshot to the live leaf', async () => {
    vi.mocked(fetchConsoleQueues).mockResolvedValue({ status: 'success', data: mixedSummary })
    await view()
    expect(screen.getByRole('heading', { level: 1, name: 'Background work' })).toBeInTheDocument()
    expect(screen.getByText(/shared by every API and worker process/)).toBeInTheDocument()
    expect(screen.getByText(`live ${mixedSummary.checkedAt}`)).toBeInTheDocument()
  })

  it('shows the explicit primary-unavailable state, never an empty list, when the request fails', async () => {
    vi.mocked(fetchConsoleQueues).mockResolvedValue({ status: 'unavailable', reason: 'upstream' })
    await view()
    expect(screen.getByRole('heading', { level: 1, name: 'Background work' })).toBeInTheDocument()
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument()
    expect(screen.queryByText(/^live /)).toBeNull()
  })

  it('lets an unexpected 4xx reach the real error boundary', async () => {
    vi.mocked(fetchConsoleQueues).mockRejectedValue(
      new BackendRequestError('rejected', 'corr-1', 403)
    )
    await expect(BackgroundWorkPage()).rejects.toBeInstanceOf(BackendRequestError)
  })
})
