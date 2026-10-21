import { useEffect, useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE, type ScheduledRunsResponse } from '@amcore/shared'
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { consoleApi } from '@/shared/api/console-api'
import { ApiRequestError } from '@/shared/api/http-client'

import { useScheduledJobs } from '../model/use-scheduled-jobs'

import { ScheduledJobsScopeProvider } from './scheduled-jobs-context'
import { response, succeededJob } from './scheduled-jobs-fixtures'
import { scheduledJobsMessages } from './scheduled-jobs-test-messages'
import { ScheduledJobHistory } from './ScheduledJobHistory'

const refreshPage = vi.fn()
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh: refreshPage }),
}))
vi.mock('@/shared/api/console-api', () => ({
  consoleApi: { getScheduledJobs: vi.fn(), getScheduledJobRuns: vi.fn() },
}))
vi.mock('@/shared/ui/console-detail/ConsoleTimestamp', () => ({
  ConsoleTimestamp: ({ value }: { value: string }) => <time>{value}</time>,
}))
vi.mock('@/shared/ui/api-error-alert', () => ({
  ApiErrorAlert: ({ error }: { error: unknown }) => (error ? <p role="alert">api error</p> : null),
}))

const initial = response([succeededJob])
const list = vi.mocked(consoleApi.getScheduledJobs)
const runs = vi.mocked(consoleApi.getScheduledJobRuns)
const page = (checkedAt: string): ScheduledRunsResponse => ({
  jobId: 'cleanup',
  checkedAt,
  truncated: false,
  runs: [
    {
      runId: '00000000-0000-4000-8000-000000000001',
      startedAt: '2026-10-21T02:00:00.000Z',
      finishedAt: '2026-10-21T02:00:04.000Z',
      state: 'success',
      durationMs: 4000,
      code: null,
      summary: null,
    },
  ],
})

/** The real hook wired to a real history, the way the page assembles them. */
function Harness({ auto = true }: { auto?: boolean }) {
  const [mountedAt] = useState(() => Date.now())
  const live = useScheduledJobs(initial, mountedAt)
  const { setAuto } = live
  useEffect(() => {
    if (!auto) setAuto(false)
  }, [auto, setAuto])
  if (!live.data) return <p>hidden</p>
  return (
    <ScheduledJobsScopeProvider
      value={{ instance: live.instance, onAccessLoss: live.reportAccessLoss }}
    >
      <button onClick={() => void live.refresh()}>Refresh now</button>
      <ScheduledJobHistory jobId="cleanup" />
    </ScheduledJobsScopeProvider>
  )
}

let client: QueryClient
function view(props: { auto?: boolean } = {}) {
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={scheduledJobsMessages}>
        <Harness {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}
const open = () => fireEvent.click(screen.getByText('Run history'))
const refreshNow = () => fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }))

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient()
  focusManager.setFocused(true)
  onlineManager.setOnline(true)
  list.mockResolvedValue({ ...response([succeededJob]), checkedAt: '2026-10-21T09:21:00.000Z' })
})
afterEach(() => client.clear())

describe('history follows the page', () => {
  it('requests nothing for a closed history, even when the page refreshes', async () => {
    view()
    refreshNow()
    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(runs).not.toHaveBeenCalled()
  })

  it('refreshes an opened history together with the page and shows the newer runs', async () => {
    runs.mockResolvedValueOnce(page('2026-10-21T09:20:00.000Z'))
    view()
    open()
    await screen.findByText('Success')
    runs.mockResolvedValueOnce(page('2026-10-21T09:21:30.000Z'))
    refreshNow()
    await waitFor(() => expect(runs).toHaveBeenCalledTimes(2))
  })

  it('keeps the older runs and says from when they are when the history refresh fails', async () => {
    runs.mockResolvedValueOnce(page('2026-10-21T09:20:00.000Z'))
    view()
    open()
    await screen.findByText('Success')
    runs.mockRejectedValueOnce(new ApiRequestError(503, undefined))
    refreshNow()
    expect(await screen.findByText(/Showing runs read at/)).toBeInTheDocument()
    expect(screen.getByText('2026-10-21T09:20:00.000Z')).toBeInTheDocument()
    expect(screen.getByText('Success')).toBeInTheDocument()
  })
})

describe('losing access', () => {
  it('hides everything, removes the cache and asks the Console frame once when a history is refused, with auto-refresh off', async () => {
    runs.mockRejectedValue(new ApiRequestError(401, undefined))
    view({ auto: false })
    open()
    expect(await screen.findByText('hidden')).toBeInTheDocument()
    expect(refreshPage).toHaveBeenCalledTimes(1)
    const kept = client
      .getQueryCache()
      .findAll({ predicate: (query) => query.queryKey[1] === 'scheduled-jobs' })
    expect(kept.filter((query) => query.state.data !== undefined)).toHaveLength(0)
  })

  it('aborts an in-flight history request and drops a retained one when the list is refused', async () => {
    let signal: AbortSignal | undefined
    runs.mockResolvedValueOnce(page('2026-10-21T09:20:00.000Z'))
    view()
    open()
    await screen.findByText('Success')
    runs.mockImplementationOnce(
      (_id, abort) =>
        new Promise(() => {
          signal = abort
        })
    )
    list.mockRejectedValueOnce(new ApiRequestError(403, undefined))
    // The page refresh succeeds in starting the history refetch only after the list answers; here the
    // list is refused first, so the retained history must disappear with the rest.
    refreshNow()
    expect(await screen.findByText('hidden')).toBeInTheDocument()
    expect(screen.queryByText('Success')).not.toBeInTheDocument()
    expect(refreshPage).toHaveBeenCalledTimes(1)
    if (signal) expect(signal.aborted).toBe(true)
  })

  it('does not ask the Console frame twice when the list and a history are refused together', async () => {
    runs.mockRejectedValue(new ApiRequestError(403, undefined))
    list.mockRejectedValue(new ApiRequestError(403, undefined))
    view()
    open()
    refreshNow()
    await screen.findByText('hidden')
    await act(async () => void (await Promise.resolve()))
    expect(refreshPage).toHaveBeenCalledTimes(1)
  })
})
