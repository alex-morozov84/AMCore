import { cookies } from 'next/headers'
import { vi } from 'vitest'

import type { VaultEntry } from './session-vault.types'

export function mockSessionCookie(value: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn().mockReturnValue(value ? { value } : undefined),
  } as never)
}

export function fakeVaultEntry(): VaultEntry {
  return {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    accessTokenExpiresAt: Date.now() + 60_000,
    userSnapshot: { id: 'u1', email: 'u1@example.com' } as never,
    version: 1,
  }
}

export function fakeUpstream(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status })
}
