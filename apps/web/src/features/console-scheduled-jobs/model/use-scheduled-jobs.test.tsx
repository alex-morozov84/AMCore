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

import { job, response, succeededJob } from '../ui/scheduled-jobs-fixtures'

import { useScheduledJobs } from './use-scheduled-jobs'

const refresh = vi.fn()
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh }),
}))
vi.mock('@/shared/api/console-api', () => ({ consoleApi: { getScheduledJobs: vi.fn() } }))

const api = vi.mocked(consoleApi.getScheduledJobs)
const initial = response([succeededJob])
const fresh = { ...response([job({ id: 'cleanup' })]), checkedAt: '2026-10-21T09:21:00.000Z' }

interface Call {
  resolve: (value: typeof fresh) => void
  reject: (error: unknown) => void
}
const calls: Call[] = []
function holdRequests() {
  calls.length = 0
  api.mockImplementation(
    () => new Promise((resolve, reject) => void calls.push({ resolve, reject }))
  )
}
const flush = () => vi.advanceTimersByTimeAsync(0)
const settle = async (index: number) =>
  act(async () => {
    calls[index]?.resolve(fresh)
    await flush()
  })
const fail = async (index: number, error: unknown) =>
  act(async () => {
    calls[index]?.reject(error)
    await flush()
  })
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)
const mount = () => renderHook(() => useScheduledJobs(initial, Date.now()), { wrapper })

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-21T09:20:00.000Z') })
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
    expect(result.current.data).toEqual(initial)
    await advance(10_000)
    expect(calls).toHaveLength(1)
    await settle(0)
    expect(result.current.data).toEqual(fresh)
    expect(result.current.refreshFailed).toBe(false)
  })

  it('does not fetch while auto-refresh is paused, and a manual refresh still works', async () => {
    const { result } = mount()
    act(() => result.current.setAuto(false))
    await advance(120_000)
    expect(calls).toHaveLength(0)
    await act(async () => void result.current.refresh())
    expect(calls).toHaveLength(1)
    await settle(0)
    expect(result.current.data).toEqual(fresh)
  })

  it('does not fetch while the tab is hidden', async () => {
    mount()
    act(() => focusManager.setFocused(false))
    await advance(120_000)
    expect(calls).toHaveLength(0)
  })
})

describe('failures', () => {
  it('keeps the old rows, flags the refresh as failed and backs the next automatic fetch off', async () => {
    const { result } = mount()
    await advance(30_000)
    await fail(0, new ApiRequestError(503, undefined))
    expect(result.current.data).toEqual(initial)
    expect(result.current.refreshFailed).toBe(true)
    await advance(29_000)
    expect(calls).toHaveLength(1) // 30 s backoff after the first failure
    await advance(31_000)
    expect(calls).toHaveLength(2)
  })

  it('honours Retry-After for a manual refresh too', async () => {
    const { result } = mount()
    await advance(30_000)
    await fail(0, new ApiRequestError(429, undefined, 120))
    expect(result.current.canRefresh).toBe(false)
    expect(result.current.retryAfterSeconds).toBeGreaterThan(100)
    await act(async () => void result.current.refresh())
    expect(calls).toHaveLength(1)
  })

  it('treats a failed or overdue job as a successful read: it does not back polling off', async () => {
    const { result } = mount()
    await advance(30_000)
    await settle(0)
    expect(result.current.refreshFailed).toBe(false)
    await advance(30_000)
    expect(calls).toHaveLength(2)
  })

  it('hides the data at once on 401/403 and asks the Console frame to admit the session again', async () => {
    const { result } = mount()
    await advance(30_000)
    await fail(0, new ApiRequestError(403, undefined))
    expect(result.current.denied).toBe(true)
    expect(result.current.data).toBeNull()
    expect(refresh).toHaveBeenCalledTimes(1)
    await advance(120_000)
    expect(calls).toHaveLength(1)
  })
})

describe('offline', () => {
  it('never queues a manual refresh while offline', async () => {
    const { result } = mount()
    act(() => onlineManager.setOnline(false))
    expect(result.current.canRefresh).toBe(false)
    await act(async () => void result.current.refresh())
    expect(calls).toHaveLength(0)
  })
})
