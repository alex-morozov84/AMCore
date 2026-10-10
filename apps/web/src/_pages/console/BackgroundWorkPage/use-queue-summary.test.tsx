import type { ReactNode } from 'react'
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { consoleApi } from '@/shared/api/console-api'
import { ApiRequestError } from '@/shared/api/http-client'

import { allUnavailableSummary, availableQueue, mixedSummary, summary } from './queue-fixtures'
import { useQueueSummary } from './use-queue-summary'

const refresh = vi.fn()
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh }),
}))
vi.mock('@/shared/api/console-api', () => ({
  consoleApi: { getBackgroundWorkQueues: vi.fn(), getBackgroundWork: vi.fn() },
}))

const api = vi.mocked(consoleApi.getBackgroundWorkQueues)
const healthy = summary([availableQueue('email')], '2026-10-03T12:00:30.000Z')

interface Call {
  signal?: AbortSignal
  resolve: (value: typeof healthy) => void
  reject: (error: unknown) => void
}
const calls: Call[] = []

/** Every request is held until the test settles it, so in-flight behaviour is observable. */
function holdRequests() {
  calls.length = 0
  api.mockImplementation(
    (signal) =>
      new Promise((resolve, reject) => {
        calls.push({ signal, resolve, reject })
      })
  )
}
// TanStack batches notifications on a 0 ms timer, which fake timers hold until advanced.
const flush = () => vi.advanceTimersByTimeAsync(0)
const settle = async (index: number, value = healthy) => {
  await act(async () => {
    calls[index]?.resolve(value)
    await flush()
  })
}
const fail = async (index: number, error: unknown) => {
  await act(async () => {
    calls[index]?.reject(error)
    await flush()
  })
}
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)
function mount(initial = mixedSummary) {
  return renderHook(() => useQueueSummary(initial, Date.now()), { wrapper })
}
const show = () => act(() => focusManager.setFocused(true))
const hide = () => act(() => focusManager.setFocused(false))
const goOnline = () => act(() => onlineManager.setOnline(true))
const goOffline = () => act(() => onlineManager.setOnline(false))

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-03T12:00:00.000Z') })
  client = new QueryClient()
  client.mount()
  focusManager.setFocused(true)
  onlineManager.setOnline(true)
  refresh.mockClear()
  holdRequests()
})
afterEach(() => {
  client.unmount()
  client.clear()
  vi.useRealTimers()
})

describe('automatic refresh', () => {
  it('shows the server snapshot without fetching, then refreshes about every 30 s', async () => {
    const { result } = mount()
    await advance(20_000)
    expect(calls).toHaveLength(0)
    expect(result.current.data).toEqual(mixedSummary)
    await advance(10_000)
    expect(calls).toHaveLength(1)
    await settle(0)
    expect(result.current.data).toEqual(healthy)
  })

  it('does not fetch while auto-refresh is paused, even on focus/online, and resumes on demand', async () => {
    const { result } = mount()
    act(() => result.current.setAuto(false))
    await advance(120_000)
    await hide()
    await show()
    await goOffline()
    await goOnline()
    expect(calls).toHaveLength(0)
    act(() => result.current.setAuto(true))
    await advance(1)
    expect(calls).toHaveLength(1)
  })
})

describe('hidden tab', () => {
  it('does not fetch while the cool-down elapses in a hidden tab, then refreshes once on return', async () => {
    mount()
    await advance(30_000)
    await fail(0, new ApiRequestError(429, undefined, 40)) // cool-down until t≈70 s
    await hide()
    await advance(300_000) // many intervals and the whole cool-down pass while hidden
    expect(calls).toHaveLength(1)
    await show()
    await advance(1)
    expect(calls).toHaveLength(2) // exactly one refresh, no catch-up burst
    await advance(5_000)
    expect(calls).toHaveLength(2)
  })

  it('cancels an automatic fetch that is in flight when the tab is hidden, and refetches once on return', async () => {
    const { result } = mount()
    await advance(30_000)
    expect(calls).toHaveLength(1)
    await hide()
    expect(calls[0]?.signal?.aborted).toBe(true)
    await settle(0) // a late response must not be applied
    expect(result.current.data).toEqual(mixedSummary)
    await show()
    await advance(1)
    expect(calls).toHaveLength(2)
  })
})

describe('offline', () => {
  it('queues nothing while offline and fetches once when it can', async () => {
    const { result } = mount()
    await goOffline()
    await advance(120_000)
    expect(calls).toHaveLength(0)
    expect(result.current.canRefresh).toBe(false)
    await goOnline()
    await advance(1)
    expect(calls).toHaveLength(1)
  })

  it('does not resume an automatic fetch on reconnect after auto-refresh is switched off', async () => {
    const { result } = mount()
    await advance(30_000)
    expect(calls).toHaveLength(1)
    await goOffline() // in flight request loses admission
    act(() => result.current.setAuto(false))
    await goOnline()
    await advance(60_000)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.signal?.aborted).toBe(true)
  })

  it('never queues a manual refresh while offline and does not replay it on reconnect', async () => {
    const { result } = mount()
    act(() => result.current.setAuto(false))
    await goOffline()
    await act(async () => result.current.refresh())
    await goOnline()
    await advance(60_000)
    expect(calls).toHaveLength(0)
  })
})

describe('manual refresh', () => {
  it('works with auto-refresh paused and joins a fetch already in flight', async () => {
    const { result } = mount()
    act(() => result.current.setAuto(false))
    await act(async () => void result.current.refresh())
    expect(calls).toHaveLength(1)
    await act(async () => void result.current.refresh())
    expect(calls).toHaveLength(1)
    await settle(0)
    expect(result.current.data).toEqual(healthy)
  })

  it('survives losing automatic admission while it is in flight', async () => {
    const { result } = mount()
    await act(async () => void result.current.refresh())
    act(() => result.current.setAuto(false))
    expect(calls[0]?.signal?.aborted).toBe(false)
    await settle(0)
    expect(result.current.data).toEqual(healthy)
  })

  it('honours Retry-After for manual and automatic triggers, and unblocks afterwards', async () => {
    const { result } = mount()
    await act(async () => void result.current.refresh())
    await fail(0, new ApiRequestError(429, undefined, 90))
    expect(result.current.canRefresh).toBe(false)
    expect(result.current.retryAfterSeconds).toBeGreaterThan(80)
    await act(async () => void result.current.refresh())
    await show()
    await advance(60_000)
    expect(calls).toHaveLength(1)
    await advance(35_000)
    expect(result.current.canRefresh).toBe(true)
    expect(calls).toHaveLength(2) // the automatic trigger resumed after the floor
  })
})

describe('independent cool-down clocks', () => {
  it('frees manual refresh when a short Retry-After ends, while automatic backoff still holds', async () => {
    const { result } = mount()
    act(() => result.current.setAuto(false))
    await act(async () => void result.current.refresh())
    await fail(0, new ApiRequestError(429, undefined, 2))
    expect(result.current.canRefresh).toBe(false)
    expect(result.current.retryAfterSeconds).toBe(2)
    await advance(1_000)
    expect(result.current.retryAfterSeconds).toBe(1) // an honest countdown, not a frozen number
    await advance(1_100)
    expect(result.current.retryAfterSeconds).toBe(0)
    expect(result.current.canRefresh).toBe(true)
    act(() => result.current.setAuto(true))
    await advance(5_000)
    expect(calls).toHaveLength(1) // the 30 s backoff still suppresses automatic fetches
    await act(async () => void result.current.refresh())
    expect(calls).toHaveLength(2) // while the manual refresh is available again
  })

  it('keeps manual refresh blocked for a long Retry-After and frees it exactly then', async () => {
    const { result } = mount()
    await act(async () => void result.current.refresh())
    await fail(0, new ApiRequestError(429, undefined, 45))
    await advance(30_000)
    expect(result.current.canRefresh).toBe(false)
    await advance(15_500)
    expect(result.current.canRefresh).toBe(true)
  })
})

describe('request left paused while offline', () => {
  it('is cancelled when auto-refresh is switched off although admission was already false', async () => {
    const { result } = mount()
    await advance(20_000)
    await goOffline()
    // The paused state TanStack produces for a fetch started offline; queryFn has not run.
    const query = client.getQueryCache().getAll()[0]
    const key = query?.queryKey ?? []
    void client.fetchQuery({ queryKey: key }).catch(() => undefined)
    await advance(1)
    expect(query?.state.fetchStatus).toBe('paused')
    act(() => result.current.setAuto(false))
    await advance(1)
    expect(query?.state.fetchStatus).toBe('idle')
    await goOnline()
    await advance(1)
    expect(calls).toHaveLength(0)
  })
})

describe('degraded and failing responses', () => {
  it('backs off 30 s, 60 s, 120 s while every queue stays unavailable (typed 200)', async () => {
    mount()
    await advance(30_000)
    await settle(0, allUnavailableSummary as typeof healthy) // streak 1: next at +30 s
    await advance(29_000)
    expect(calls).toHaveLength(1)
    await advance(2_000)
    expect(calls).toHaveLength(2)
    await settle(1, allUnavailableSummary as typeof healthy) // streak 2: next at +60 s
    await advance(59_000)
    expect(calls).toHaveLength(2)
    await advance(2_000)
    expect(calls).toHaveLength(3)
  })

  it('resets the streak on a healthy mixture of available and unavailable rows', async () => {
    mount()
    await advance(30_000)
    await settle(0, allUnavailableSummary as typeof healthy)
    await advance(31_000)
    await settle(1, mixedSummary)
    await advance(30_500)
    expect(calls).toHaveLength(3) // back to the base period, not 60 s
  })

  it('keeps showing older rows and flags a failed refresh', async () => {
    const { result } = mount()
    await advance(30_000)
    await fail(0, new Error('boom'))
    expect(result.current.data).toEqual(mixedSummary)
    expect(result.current.refreshFailed).toBe(true)
  })
})

describe('access loss', () => {
  it('hides the rows at once, evicts the cache, stops every trigger and re-admits once', async () => {
    const evict = vi.spyOn(client, 'removeQueries')
    const { result, unmount } = mount()
    await advance(30_000)
    await fail(0, new ApiRequestError(403, undefined))
    expect(result.current.data).toBeNull()
    expect(result.current.denied).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(evict).toHaveBeenCalledTimes(1)
    unmount()
    await advance(1)
    expect(client.getQueryCache().getAll()).toHaveLength(0) // gcTime 0: nothing survives the mount
    await act(async () => void result.current.refresh()) // a denied manual handler starts nothing
    await show()
    await goOnline()
    await advance(600_000)
    expect(calls).toHaveLength(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows no rows after a 401 from an automatic fetch', async () => {
    const { result } = mount()
    await advance(30_000)
    await fail(0, new ApiRequestError(401, undefined))
    await advance(1_000)
    expect(result.current.data).toBeNull()
  })

  it('starts a fresh client state when the server sends a new snapshot', async () => {
    const first = mount()
    await advance(30_000)
    await fail(0, new ApiRequestError(401, undefined))
    first.unmount()
    await advance(1)
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    const second = renderHook(() => useQueueSummary(healthy, Date.now()), { wrapper })
    expect(second.result.current.denied).toBe(false)
    expect(second.result.current.data).toEqual(healthy)
  })
})

describe('lifecycle', () => {
  it('aborts the browser request on unmount', async () => {
    const { unmount } = mount()
    await advance(30_000)
    expect(calls[0]?.signal?.aborted).toBe(false)
    unmount()
    expect(calls[0]?.signal?.aborted).toBe(true)
    await advance(300_000)
    expect(calls).toHaveLength(1)
  })

  it('validates the payload: a malformed response is a failure, never rendered', async () => {
    const { result } = mount()
    await advance(30_000)
    await settle(0, {
      checkedAt: 'x',
      queues: [{ name: 'Bad Name', kind: 'work', status: 'available' }],
    } as never)
    expect(result.current.data).toEqual(mixedSummary)
    expect(result.current.refreshFailed).toBe(true)
  })
})

describe('page-wide refresh', () => {
  it('keeps fresh DB-owned catalogue data when only the broker overview request fails', async () => {
    vi.mocked(consoleApi.getBackgroundWork).mockResolvedValue([])
    const { result, unmount } = renderHook(() => useQueueSummary(mixedSummary, Date.now(), []), {
      wrapper,
    })
    await advance(30_000)
    await fail(0, new ApiRequestError(503, undefined))
    expect(result.current.data).toEqual(mixedSummary)
    expect(result.current.refreshFailed).toBe(true)
    expect(result.current.partial).toBe(true)
    expect(result.current.workError).toBeNull()
    expect(result.current.works).toEqual([])
    unmount()
  })
  it('refreshes registration data with queues and keeps it visibly stale on partial failure', async () => {
    vi.mocked(consoleApi.getBackgroundWork).mockResolvedValue([])
    const { result, unmount } = renderHook(() => useQueueSummary(mixedSummary, Date.now(), []), {
      wrapper,
    })
    await advance(30_000)
    await settle(0)
    expect(consoleApi.getBackgroundWork).toHaveBeenCalledTimes(1)
    expect(result.current.partial).toBe(false)
    vi.mocked(consoleApi.getBackgroundWork).mockRejectedValue(new Error('Catalogue unavailable'))
    await advance(30_000)
    await settle(1)
    expect(result.current.works).toEqual([])
    expect(result.current.partial).toBe(true)
    expect(result.current.workError).toBeInstanceOf(Error)
    unmount()
  })
})
