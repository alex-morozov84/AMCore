// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('./session-vault-store', () => ({
  redisConsoleVaultStore: { create: vi.fn(), get: vi.fn() },
}))

import { cookies } from 'next/headers'

import { CONSOLE_AUDIENCE, getCurrentConsoleSession, mintConsoleSession } from './session'
import { redisConsoleVaultStore } from './session-vault-store'

const cookieStore = { get: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(cookies).mockResolvedValue(cookieStore as never)
})

describe('console session vault', () => {
  it('stores an explicit console audience when minting', async () => {
    await mintConsoleSession({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { id: 'user-1' } as never,
    })

    expect(redisConsoleVaultStore.create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ audience: CONSOLE_AUDIENCE })
    )
  })

  it('rejects a vault entry without the console audience', async () => {
    cookieStore.get.mockReturnValue({ value: 'session-1' })
    vi.mocked(redisConsoleVaultStore.get).mockResolvedValue({ audience: 'product' } as never)

    await expect(getCurrentConsoleSession()).resolves.toBeNull()
  })

  it('accepts a matching console audience from its own vault', async () => {
    cookieStore.get.mockReturnValue({ value: 'session-1' })
    vi.mocked(redisConsoleVaultStore.get).mockResolvedValue({ audience: CONSOLE_AUDIENCE } as never)

    await expect(getCurrentConsoleSession()).resolves.toMatchObject({ sessionId: 'session-1' })
  })
})
