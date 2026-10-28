import { contextSessionBinding } from './context-session'
import type { CurrentVaultSession } from './current-session'

export function makeRequest(
  session: CurrentVaultSession | null = fakeSession(),
  expected?: string
): Request {
  return new Request('http://next.internal/api/auth/logout', {
    method: 'POST',
    headers: session
      ? {
          cookie: `amcore_session=${session.sessionId}; amcore_browser_context=${'a'.repeat(43)}`,
          'x-amcore-context-session':
            expected ?? contextSessionBinding(session.sessionId, session.entry),
        }
      : {},
  })
}
export function fakeSession(
  sessionId = 's'.repeat(43),
  refreshToken = 'rt-1'
): CurrentVaultSession {
  return {
    sessionId,
    entry: {
      accessToken: 'at-1',
      refreshToken,
      accessTokenExpiresAt: Date.now() + 60000,
      userSnapshot: { id: 'user-A' } as never,
      version: 1,
      audience: 'product',
      browser: {
        audience: 'product',
        contextId: 'context-A',
        generation: 1,
        familyId: 'family-A',
        securityVersion: 1,
      },
    },
  }
}
