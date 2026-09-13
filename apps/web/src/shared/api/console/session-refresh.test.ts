// @vitest-environment node
import { expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { ensureFreshSession } from '@/shared/api/bff/ensure-fresh-session'
import type { VaultLock, VaultStore } from '@/shared/api/bff/session-vault.types'

import type { ConsoleVaultRecord } from './session-vault.types'

const lock: VaultLock = {
  acquire: vi.fn().mockResolvedValue('lock-token'),
  renew: vi.fn(),
  release: vi.fn().mockResolvedValue(undefined),
}

it('retains the console audience when refresh writes through CAS', async () => {
  const entry = {
    accessToken: 'expired-access-token',
    refreshToken: 'refresh-token',
    accessTokenExpiresAt: Date.now() - 1,
    userSnapshot: {} as never,
    audience: 'console' as const,
    version: 1,
  }
  const store: VaultStore<ConsoleVaultRecord> = {
    get: vi.fn().mockResolvedValue(entry),
    create: vi.fn(),
    setIfVersionMatches: vi.fn().mockResolvedValue(true),
    delete: vi.fn(),
  }

  const refreshed = await ensureFreshSession('session-1', {
    store,
    lock,
    upstreamRefresh: vi.fn().mockResolvedValue({
      accessToken: 'fresh-access-token',
      refreshToken: 'refreshed-token',
      accessTokenExpiresAt: Date.now() + 60_000,
    }),
  })

  expect(store.setIfVersionMatches).toHaveBeenCalledWith(
    'session-1',
    1,
    expect.objectContaining({ audience: 'console' })
  )
  expect(refreshed).toMatchObject({ audience: 'console', version: 2 })
})
