import { cookies } from 'next/headers'
import { vi } from 'vitest'

import type { VaultEntry } from './session-vault.types'
import { makeBrowserEntry } from './test-fakes'

export function mockSessionCookie(value: string | undefined) {
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-sessions-test-key-at-least-32-characters>')
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn().mockReturnValue(value ? { value } : undefined),
  } as never)
}

export function fakeVaultEntry(): VaultEntry {
  return makeBrowserEntry({ userSnapshot: { id: 'u1', email: 'u1@example.com' } as never })
}

export function fakeUpstream(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status })
}
