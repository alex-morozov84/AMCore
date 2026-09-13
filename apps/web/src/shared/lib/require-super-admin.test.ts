import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('not found')
  }),
}))

vi.mock('server-only', () => ({}))
vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))
vi.mock('next/navigation', () => ({ notFound }))
vi.mock('@/shared/api/server/access-token', () => ({ getBackendAccessToken: vi.fn() }))

import { getBackendAccessToken } from '@/shared/api/server/access-token'

import { requireSuperAdmin } from './require-super-admin'

const mockedAccessToken = vi.mocked(getBackendAccessToken)
const fetchMock = vi.fn()

describe('requireSuperAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the live no-content access probe with the server-held bearer token', async () => {
    mockedAccessToken.mockResolvedValue('server-held-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    await expect(requireSuperAdmin()).resolves.toBeUndefined()

    expect(fetch).toHaveBeenCalledWith('http://localhost:5002/api/v1/admin/access', {
      cache: 'no-store',
      headers: { Authorization: 'Bearer server-held-token' },
    })
  })

  it.each([401, 403, 500])('fails closed for probe status %i', async (status) => {
    mockedAccessToken.mockResolvedValue('server-held-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))

    await expect(requireSuperAdmin()).rejects.toThrow('not found')
  })

  it('fails closed when no server-held bearer token or upstream response exists', async () => {
    mockedAccessToken.mockResolvedValue(null)

    await expect(requireSuperAdmin()).rejects.toThrow('not found')
    expect(fetchMock).not.toHaveBeenCalled()

    mockedAccessToken.mockResolvedValue('server-held-token')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unavailable')))

    await expect(requireSuperAdmin()).rejects.toThrow('not found')
  })
})
