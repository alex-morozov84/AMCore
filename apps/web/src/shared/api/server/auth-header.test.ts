import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getBackendAccessToken } from './access-token'
import { resolveAuthHeader } from './auth-header'
import { BackendAuthRequiredError } from './errors'

vi.mock('server-only', () => ({}))
vi.mock('./access-token', () => ({ getBackendAccessToken: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveAuthHeader', () => {
  it("'none' never calls getBackendAccessToken and returns no header", async () => {
    const result = await resolveAuthHeader('none')

    expect(result).toEqual({})
    expect(getBackendAccessToken).not.toHaveBeenCalled()
  })

  it("'optional' attaches a Bearer header when a session exists", async () => {
    vi.mocked(getBackendAccessToken).mockResolvedValue('at-1')

    expect(await resolveAuthHeader('optional')).toEqual({ header: 'Bearer at-1' })
  })

  it("'optional' proceeds anonymously (no header, no throw) when genuinely logged out", async () => {
    vi.mocked(getBackendAccessToken).mockResolvedValue(null)

    expect(await resolveAuthHeader('optional')).toEqual({})
  })

  it("'optional' reports unavailable (never silently anonymous) when the vault throws", async () => {
    vi.mocked(getBackendAccessToken).mockRejectedValue(new Error('Redis unreachable'))

    expect(await resolveAuthHeader('optional')).toEqual({ unavailable: true })
  })

  it("'required' attaches a Bearer header when a session exists", async () => {
    vi.mocked(getBackendAccessToken).mockResolvedValue('at-1')

    expect(await resolveAuthHeader('required')).toEqual({ header: 'Bearer at-1' })
  })

  it("'required' throws BackendAuthRequiredError when genuinely logged out", async () => {
    vi.mocked(getBackendAccessToken).mockResolvedValue(null)

    await expect(resolveAuthHeader('required')).rejects.toBeInstanceOf(BackendAuthRequiredError)
  })

  it("'required' reports unavailable (not BackendAuthRequiredError) when the vault throws", async () => {
    vi.mocked(getBackendAccessToken).mockRejectedValue(new Error('Redis unreachable'))

    expect(await resolveAuthHeader('required')).toEqual({ unavailable: true })
  })
})
