import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE, type ScheduledRun } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { consoleApi } from '@/shared/api/console-api'
import { ApiRequestError } from '@/shared/api/http-client'

import { scheduledJobsMessages } from './scheduled-jobs-test-messages'
import { ScheduledJobHistory } from './ScheduledJobHistory'

vi.mock('@/shared/api/console-api', () => ({ consoleApi: { getScheduledJobRuns: vi.fn() } }))
vi.mock('@/shared/ui/console-detail/ConsoleTimestamp', () => ({
  ConsoleTimestamp: ({ value }: { value: string }) => <time>{value}</time>,
}))
vi.mock('@/shared/ui/api-error-alert', () => ({
  ApiErrorAlert: ({ error }: { error: unknown }) => (error ? <p role="alert">api error</p> : null),
}))

const runs = vi.mocked(consoleApi.getScheduledJobRuns)
const run = (over: Partial<ScheduledRun> = {}): ScheduledRun => ({
  runId: '00000000-0000-4000-8000-000000000001',
  startedAt: '2026-10-21T02:00:00.000Z',
  finishedAt: '2026-10-21T02:00:04.000Z',
  state: 'success',
  durationMs: 4000,
  code: null,
  summary: null,
  ...over,
})

function view() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={scheduledJobsMessages}>
        <ScheduledJobHistory jobId="cleanup" instance="i" />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}
const open = () => fireEvent.click(screen.getByText('Run history'))

beforeEach(() => vi.clearAllMocks())

describe('run history', () => {
  it('reads nothing until it is opened', async () => {
    runs.mockResolvedValue({
      jobId: 'cleanup',
      checkedAt: '2026-10-21T09:20:00.000Z',
      runs: [],
      truncated: false,
    })
    view()
    await Promise.resolve()
    expect(runs).not.toHaveBeenCalled()
    open()
    await waitFor(() => expect(runs).toHaveBeenCalledWith('cleanup', expect.any(AbortSignal)))
  })

  it('lists runs with their start, end, duration and the failure in words', async () => {
    runs.mockResolvedValue({
      jobId: 'cleanup',
      checkedAt: '2026-10-21T09:20:00.000Z',
      truncated: false,
      runs: [
        run({
          runId: '00000000-0000-4000-8000-000000000002',
          state: 'failed',
          code: 'all_buckets_failed',
          durationMs: 3000,
        }),
        run(),
        run({
          runId: '00000000-0000-4000-8000-000000000003',
          state: 'unknown',
          finishedAt: null,
          durationMs: null,
        }),
      ],
    })
    view()
    open()
    expect(await screen.findByText('All steps failed')).toBeInTheDocument()
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('The end of this run was not recorded.')).toBeInTheDocument()
    expect(screen.queryByText('all_buckets_failed')).not.toBeInTheDocument()
  })

  it('says so when no run is recorded and when older runs exist', async () => {
    runs.mockResolvedValue({
      jobId: 'cleanup',
      checkedAt: '2026-10-21T09:20:00.000Z',
      runs: [],
      truncated: false,
    })
    const { unmount } = view()
    open()
    expect(await screen.findByText('No runs recorded yet.')).toBeInTheDocument()
    unmount()

    runs.mockResolvedValue({
      jobId: 'cleanup',
      checkedAt: '2026-10-21T09:20:00.000Z',
      runs: [run()],
      truncated: true,
    })
    view()
    open()
    expect(await screen.findByText('Showing the latest 20 runs.')).toBeInTheDocument()
  })

  it('shows an error alert instead of an empty list when the read fails', async () => {
    runs.mockRejectedValue(new ApiRequestError(503, undefined))
    view()
    open()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('No runs recorded yet.')).not.toBeInTheDocument()
  })
})
