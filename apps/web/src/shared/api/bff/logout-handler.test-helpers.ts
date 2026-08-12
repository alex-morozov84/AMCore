import type { CurrentVaultSession } from './current-session'

export function makeRequest(): Request {
  return new Request('http://next.internal/api/auth/logout', { method: 'POST' })
}

export function fakeSession(sessionId = 'sess-1', refreshToken = 'rt-1'): CurrentVaultSession {
  return {
    sessionId,
    entry: {
      accessToken: 'at-1',
      refreshToken,
      accessTokenExpiresAt: Date.now() + 60_000,
      userSnapshot: {} as never,
      version: 1,
    },
  }
}
