// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { ensureFreshSession } from './ensure-fresh-session'
import type { VaultEntry } from './session-vault.types'

vi.mock('server-only', () => ({}))

const entry = (audience?: 'product' | 'staff' | 'console') =>
  ({
    audience,
    version: 1,
    accessToken: 'access',
    refreshToken: 'refresh',
    accessTokenExpiresAt: 0,
    userSnapshot: { id: 'user' },
  }) as VaultEntry

describe('audience before refresh', () => {
  it.each(['product', 'console', undefined] as const)(
    'rejects %p before touching staff lock/upstream',
    async (audience) => {
      const store = {
        get: vi.fn().mockResolvedValue(entry(audience)),
        create: vi.fn(),
        setIfVersionMatches: vi.fn(),
        delete: vi.fn(),
      }
      const lock = { acquire: vi.fn(), renew: vi.fn(), release: vi.fn() }
      const upstreamRefresh = vi.fn()
      await expect(
        ensureFreshSession('opaque-id', {
          store,
          lock,
          verifyBinding: async () => undefined,
          upstreamRefresh,
          expectedAudience: 'staff',
        })
      ).rejects.toThrow()
      expect(lock.acquire).not.toHaveBeenCalled()
      expect(upstreamRefresh).not.toHaveBeenCalled()
    }
  )

  it('checks audience again inside the acquired refresh lock', async () => {
    const store = {
      get: vi.fn().mockResolvedValueOnce(entry('staff')).mockResolvedValueOnce(entry('product')),
      create: vi.fn(),
      setIfVersionMatches: vi.fn(),
      delete: vi.fn(),
    }
    const lock = { acquire: vi.fn().mockResolvedValue('lease'), renew: vi.fn(), release: vi.fn() }
    const upstreamRefresh = vi.fn()
    await expect(
      ensureFreshSession('opaque-id', {
        store,
        lock,
        verifyBinding: async () => undefined,
        upstreamRefresh,
        expectedAudience: 'staff',
      })
    ).rejects.toThrow()
    expect(lock.release).toHaveBeenCalledWith('opaque-id', 'lease')
    expect(upstreamRefresh).not.toHaveBeenCalled()
    expect(store.setIfVersionMatches).not.toHaveBeenCalled()
  })
})
