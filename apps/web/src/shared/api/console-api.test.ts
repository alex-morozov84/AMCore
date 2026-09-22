import { SystemRole } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/console-public-api-path', () => ({ getConsolePublicApiPath: vi.fn() }))
vi.mock('./http-client', () => ({ apiClient: { patch: vi.fn(), post: vi.fn() } }))

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
})
