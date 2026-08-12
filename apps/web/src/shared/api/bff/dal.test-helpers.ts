import { cookies } from 'next/headers'
import type { UserResponse } from '@amcore/shared'
import { vi } from 'vitest'

import type { VaultEntry } from './session-vault.types'

export function mockSessionCookie(value: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn().mockReturnValue(value ? { value } : undefined),
  } as never)
}

export const fakeUser = { id: 'u1', email: 'u1@example.com' } as UserResponse

export function fakeVaultEntry(user: UserResponse = fakeUser): VaultEntry {
  return {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    accessTokenExpiresAt: Date.now() + 60_000,
    userSnapshot: user,
    version: 1,
  }
}
