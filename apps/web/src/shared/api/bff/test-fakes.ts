import type { UserResponse } from '@amcore/shared'

import type { UpstreamRefreshFn, VaultEntry, VaultStore } from './session-vault.types'

export function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    refreshToken: 'rt-1',
    accessToken: 'at-1',
    accessTokenExpiresAt: Date.now() + 60_000,
    userSnapshot: {} as unknown as UserResponse,
    version: 1,
    ...overrides,
  }
}

export class FakeVaultStore implements VaultStore {
  private entries = new Map<string, VaultEntry>()

  seed(sessionId: string, entry: VaultEntry) {
    this.entries.set(sessionId, entry)
  }

  async get(sessionId: string) {
    return this.entries.get(sessionId) ?? null
  }

  async create(sessionId: string, entry: Omit<VaultEntry, 'version'>) {
    this.entries.set(sessionId, { ...entry, version: 1 })
  }

  async setIfVersionMatches(
    sessionId: string,
    expectedVersion: number,
    entry: Omit<VaultEntry, 'version'>
  ) {
    const current = this.entries.get(sessionId)
    if (!current || current.version !== expectedVersion) return false
    this.entries.set(sessionId, { ...entry, version: expectedVersion + 1 })
    return true
  }

  async delete(sessionId: string) {
    this.entries.delete(sessionId)
  }
}

export const freshRefresh = (): ReturnType<UpstreamRefreshFn> =>
  Promise.resolve({
    accessToken: 'at-2',
    accessTokenExpiresAt: Date.now() + 60_000,
    refreshToken: 'rt-2',
  })

/** Explicit published browser fixture; makeEntry still permits unbound negative cases. */
export function makeBrowserEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return makeEntry({
    audience: 'product',
    browser: {
      contextId: 'context-x',
      generation: 1,
      familyId: 'family-x',
      securityVersion: 0,
      audience: 'product',
    },
    ...overrides,
  })
}
export function browserTestHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init)
  headers.set('cookie', `amcore_browser_context=${'a'.repeat(43)}`)
  return headers
}
