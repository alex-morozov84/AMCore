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
      value={{
        instance: live.instance,
        onAccessLoss: live.reportAccessLoss,
        historyFloors: live.historyFloors,
        onHistoryFailure: live.reportHistoryFailure,
        onHistorySuccess: live.reportHistorySuccess,
      }}
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

describe('a refused history waits for its Retry-After', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
    })
  })
  afterEach(() => vi.useRealTimers())

  const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)))
  const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

  it('does not read again on a page refresh, a reopen or a manual refresh before the time, and resumes after it', async () => {
    runs.mockRejectedValueOnce(new ApiRequestError(429, undefined, 120))
    view()
    open()
    await settle()
    expect(runs).toHaveBeenCalledTimes(1)

    // The page refreshes successfully (manual): the history stays quiet.
    refreshNow()
    await settle()
    expect(list).toHaveBeenCalled()
    expect(runs).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Available in 1[0-2][0-9] seconds/)).toBeInTheDocument()

    // Closing and opening the history again does not bypass the time.
    open()
    open()
    await settle()
    expect(runs).toHaveBeenCalledTimes(1)

    // After the time the history is read again without any other action.
    runs.mockResolvedValueOnce(page('2026-10-21T09:30:00.000Z'))
    await wait(121_000)
    expect(runs).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Success')).toBeInTheDocument()
  })
})

describe('two open histories share one Retry-After', () => {
  function TwoHistories() {
    const [mountedAt] = useState(() => Date.now())
    const live = useScheduledJobs(initial, mountedAt)
    if (!live.data) return <p>hidden</p>
    return (
      <ScheduledJobsScopeProvider
        value={{
          instance: live.instance,
          onAccessLoss: live.reportAccessLoss,
          historyFloors: live.historyFloors,
          onHistoryFailure: live.reportHistoryFailure,
          onHistorySuccess: live.reportHistorySuccess,
        }}
      >
        <ScheduledJobHistory jobId="cleanup" />
        <ScheduledJobHistory jobId="invitation-retention" />
      </ScheduledJobsScopeProvider>
    )
  }

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
    })
  })
  afterEach(() => vi.useRealTimers())

  const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)))
  const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))
  const openAll = () => screen.getAllByText('Run history').forEach((node) => fireEvent.click(node))
  const reads = (jobId: string) => runs.mock.calls.filter((call) => call[0] === jobId).length

  it('keeps the wait of one history when the other one answers well, and resumes after it', async () => {
    runs.mockImplementation(async (jobId: string) => {
      if (jobId === 'cleanup') throw new ApiRequestError(429, undefined, 120)
      return page('2026-10-22T09:00:00.000Z')
    })
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={scheduledJobsMessages}>
          <TwoHistories />
        </NextIntlClientProvider>
      </QueryClientProvider>
    )
    openAll()
    await settle()
    expect(reads('cleanup')).toBe(1)
    expect(reads('invitation-retention')).toBe(1)
    // The good answer of the second history must not clear the wait of the first.
    expect(screen.getAllByText(/Available in 1[0-2][0-9] seconds/).length).toBeGreaterThan(0)

    // Closing and opening them again does not bypass the wait.
    openAll()
    openAll()
    await settle()
    expect(reads('cleanup')).toBe(1)

    // A shorter refusal of the second history does not shorten it either.
    runs.mockImplementation(async (jobId: string) => {
      if (jobId === 'cleanup') return page('2026-10-22T09:05:00.000Z')
      throw new ApiRequestError(429, undefined, 5)
    })
    await wait(6_000)
    expect(reads('cleanup')).toBe(1)

    await wait(121_000)
    expect(reads('cleanup')).toBe(2)
  })
})
