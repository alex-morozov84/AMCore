// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchConsoleBackgroundWork } from '@/shared/api/console/background-work'
import { fetchConsoleIntegrations } from '@/shared/api/console/integrations'
import { fetchConsoleOverview } from '@/shared/api/console/overview'
import { fetchConsoleQueues } from '@/shared/api/console/queues'
import { fetchConsoleScheduledJobs } from '@/shared/api/console/scheduled-jobs'
import { BackendRequestError } from '@/shared/api/server/errors'

import { sources } from './overview-problem-fixtures'
import { readOverviewSources } from './overview-sources'
vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/server', async () => import('@/shared/api/server/degrade-secondary'))
vi.mock('@/shared/lib/server-logger', () => ({ logDegradation: vi.fn() }))
vi.mock('@/shared/api/console/overview', () => ({ fetchConsoleOverview: vi.fn() }))
vi.mock('@/shared/api/console/queues', () => ({ fetchConsoleQueues: vi.fn() }))
vi.mock('@/shared/api/console/background-work', () => ({ fetchConsoleBackgroundWork: vi.fn() }))
vi.mock('@/shared/api/console/scheduled-jobs', () => ({ fetchConsoleScheduledJobs: vi.fn() }))
vi.mock('@/shared/api/console/integrations', () => ({ fetchConsoleIntegrations: vi.fn() }))
const adapters = [
  fetchConsoleOverview,
  fetchConsoleQueues,
  fetchConsoleBackgroundWork,
  fetchConsoleScheduledJobs,
  fetchConsoleIntegrations,
]
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-25T12:00:00Z'))
  const data = sources()
  vi.mocked(fetchConsoleOverview).mockResolvedValue({ status: 'success', data: data.overview! })
  vi.mocked(fetchConsoleQueues).mockResolvedValue({ status: 'success', data: data.queues! })
  vi.mocked(fetchConsoleBackgroundWork).mockResolvedValue({ status: 'success', data: data.works! })
  vi.mocked(fetchConsoleScheduledJobs).mockResolvedValue({
    status: 'success',
    data: data.scheduled!,
  })
  vi.mocked(fetchConsoleIntegrations).mockResolvedValue({
    status: 'success',
    data: data.integrations!,
  })
})
afterEach(() => vi.useRealTimers())
describe('bounded Overview source composition', () => {
  it('starts five reads once, in parallel, and reuses the Overview payload', async () => {
    const gate = Promise.withResolvers<Awaited<ReturnType<typeof fetchConsoleOverview>>>()
    vi.mocked(fetchConsoleOverview).mockReturnValue(gate.promise)
    const pending = readOverviewSources()
    for (const adapter of adapters) expect(adapter).toHaveBeenCalledTimes(1)
    gate.resolve({ status: 'success', data: sources().overview! })
    const result = await pending
    expect(result.sources).toEqual(sources())
    expect(result.retryAfterMs).toBe(0)
  })
  it('degrades each known failure independently and captures the maximum unexpired Retry-After before degradation', async () => {
    vi.mocked(fetchConsoleQueues).mockResolvedValue({
      status: 'unavailable',
      reason: 'rate-limited',
      retryAfterMs: 600000,
    })
    vi.mocked(fetchConsoleScheduledJobs).mockResolvedValue({
      status: 'unavailable',
      reason: 'rate-limited',
      retryAfterMs: 86400000,
    })
    const gate = Promise.withResolvers<Awaited<ReturnType<typeof fetchConsoleOverview>>>()
    vi.mocked(fetchConsoleOverview).mockReturnValue(gate.promise)
    const pending = readOverviewSources()
    await Promise.resolve()
    vi.setSystemTime(Date.now() + 2000)
    gate.resolve({ status: 'unavailable', reason: 'timeout' })
    const result = await pending
    expect(result.sources).toMatchObject({
      overview: null,
      queues: null,
      scheduled: null,
      works: [],
      integrations: sources().integrations,
    })
    expect(result.retryAfterMs).toBe(86400000 - 2000)
  })
  it.each([401, 403, 404, 200])(
    'propagates adapter rejection/invalid success status %i',
    async (status) => {
      const error = new BackendRequestError(
        status === 200 ? 'invalid-payload' : 'rejected',
        'test',
        status
      )
      vi.mocked(fetchConsoleIntegrations).mockRejectedValue(error)
      await expect(readOverviewSources()).rejects.toBe(error)
    }
  )
  it('refuses unexpected not-found instead of turning it into an empty source', async () => {
    vi.mocked(fetchConsoleIntegrations).mockResolvedValue({ status: 'not-found' })
    await expect(readOverviewSources()).rejects.toThrow('not-found')
  })
})
