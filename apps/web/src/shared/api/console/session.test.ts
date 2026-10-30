// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn(
    async () => new Headers({ cookie: `__Host-amcore_console_context=${'a'.repeat(43)}` })
  ),
}))
vi.mock('./session-vault-store', () => ({
  redisConsoleVaultStore: { create: vi.fn(), get: vi.fn() },
}))

import { cookies } from 'next/headers'

import { CONSOLE_AUDIENCE, getCurrentConsoleSession, mintConsoleSession } from './session'
import { redisConsoleVaultStore } from './session-vault-store'

const browser = {
  audience: 'console' as const,
  contextId: 'ctx',
  generation: 1,
  familyId: 'family',
  securityVersion: 0,
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
const cookieStore = { get: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', 'test-key-'.repeat(8))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: 'current', userId: 'user-1', ...browser }))
  )
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

    await expect(getCurrentConsoleSession()).rejects.toMatchObject({
      status: 401,
      errorCode: 'AUTH_CONTEXT_CHANGED',
    })
  })

  it('accepts a matching console audience from its own vault', async () => {
    cookieStore.get.mockReturnValue({ value: 'session-1' })
    vi.mocked(redisConsoleVaultStore.get).mockResolvedValue({
      audience: CONSOLE_AUDIENCE,
      browser,
      userSnapshot: { id: 'user-1' },
      refreshToken: 'a'.repeat(64),
    } as never)

    await expect(getCurrentConsoleSession()).resolves.toMatchObject({ sessionId: 'session-1' })
  })
})
