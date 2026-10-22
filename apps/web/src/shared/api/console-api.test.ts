import { SystemRole } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/console-public-api-path', () => ({ getConsolePublicApiPath: vi.fn() }))
vi.mock('./http-client', () => ({ apiClient: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }))

import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'

import { consoleApi } from './console-api'
import { apiClient } from './http-client'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getConsolePublicApiPath).mockImplementation((path) => `/console${path}`)
})

describe('consoleApi', () => {
  it('resolves the role-update path through getConsolePublicApiPath and PATCHes the role', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ id: 'u1' } as never)

    await consoleApi.updateUserRole('u1', SystemRole.SuperAdmin)

    expect(getConsolePublicApiPath).toHaveBeenCalledWith('/users/u1/role')
    expect(apiClient.patch).toHaveBeenCalledWith('/console/users/u1/role', {
      systemRole: SystemRole.SuperAdmin,
    })
  })

  it('resolves the step-up path through getConsolePublicApiPath and POSTs the password', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(undefined)

    await consoleApi.stepUp('correct-horse')

    expect(getConsolePublicApiPath).toHaveBeenCalledWith('/auth/step-up')
    expect(apiClient.post).toHaveBeenCalledWith('/console/auth/step-up', {
      password: 'correct-horse',
    })
  })

  it('reads the background-work queue summary through the topology-aware path and forwards the abort signal', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ checkedAt: 'x', queues: [] } as never)
    const controller = new AbortController()

    await consoleApi.getBackgroundWorkQueues(controller.signal)

    expect(getConsolePublicApiPath).toHaveBeenCalledWith('/background-work/queues')
    expect(apiClient.get).toHaveBeenCalledWith('/console/background-work/queues', {
      signal: controller.signal,
    })
  })

  it('reads the scheduled jobs list and the history of one job through the topology-aware path', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({} as never)
    const controller = new AbortController()

    await consoleApi.getScheduledJobs(controller.signal)
    await consoleApi.getScheduledJobRuns('cleanup', controller.signal)

    expect(getConsolePublicApiPath).toHaveBeenCalledWith('/scheduled-jobs')
    expect(getConsolePublicApiPath).toHaveBeenCalledWith('/scheduled-jobs/cleanup/runs')
    expect(apiClient.get).toHaveBeenCalledWith('/console/scheduled-jobs', {
      signal: controller.signal,
    })
  })
})
