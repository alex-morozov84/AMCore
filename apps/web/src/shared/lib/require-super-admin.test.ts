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
    mockedProbe.mockResolvedValue({ kind: 'admitted' })

    await expect(requireSuperAdmin()).resolves.toBe('admitted')

    expect(mockedProbe).toHaveBeenCalledOnce()
  })

  it.each([401, 403] as const)('fails closed for probe status %i', async (status) => {
    mockedProbe.mockResolvedValue({ kind: 'denied', status })

    await expect(requireSuperAdmin()).rejects.toThrow('not found')
  })

  it('returns an unavailable outcome only for an unavailable probe', async () => {
    mockedProbe.mockResolvedValue({ kind: 'upstream-unavailable' })

    await expect(requireSuperAdmin()).resolves.toBe('unavailable')
    expect(notFound).not.toHaveBeenCalled()
  })

  it.each(['indeterminate', 'denied'] as const)(
    'fails closed for %s probe result',
    async (kind) => {
      mockedProbe.mockResolvedValue(kind === 'indeterminate' ? { kind } : { kind, status: 401 })

      await expect(requireSuperAdmin()).rejects.toThrow('not found')
    }
  )
})
