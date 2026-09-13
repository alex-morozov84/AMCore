import { beforeEach, describe, expect, it, vi } from 'vitest'

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('not found')
  }),
}))

vi.mock('server-only', () => ({}))
vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))
vi.mock('next/navigation', () => ({ notFound }))
vi.mock('@/shared/api/console/access-probe', () => ({ probeConsoleAccess: vi.fn() }))

import { probeConsoleAccess } from '@/shared/api/console/access-probe'

import { requireSuperAdmin } from './require-super-admin'

const mockedProbe = vi.mocked(probeConsoleAccess)

describe('requireSuperAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('admits only the shared live no-content access probe', async () => {
    mockedProbe.mockResolvedValue(204)

    await expect(requireSuperAdmin()).resolves.toBeUndefined()

    expect(mockedProbe).toHaveBeenCalledOnce()
  })

  it.each([401, 403, 503] as const)('fails closed for probe status %i', async (status) => {
    mockedProbe.mockResolvedValue(status)

    await expect(requireSuperAdmin()).rejects.toThrow('not found')
  })

  it('fails closed for a missing server-held bearer credential', async () => {
    mockedProbe.mockResolvedValue(401)

    await expect(requireSuperAdmin()).rejects.toThrow('not found')
  })
})
