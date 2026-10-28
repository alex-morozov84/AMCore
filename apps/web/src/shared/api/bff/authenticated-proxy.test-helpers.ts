import { cookies } from 'next/headers'
import { vi } from 'vitest'

import { browserTestHeaders } from './test-fakes'

export function mockCookieStore(sessionId: string | undefined) {
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-proxy-test-key-at-least-32-characters>')
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn().mockReturnValue(sessionId ? { value: sessionId } : undefined),
  } as never)
}

export function makeRequest(pathAndQuery: string, init: RequestInit = {}): Request {
  return new Request(`http://next.internal/api/${pathAndQuery}`, {
    ...init,
    headers: browserTestHeaders(init.headers),
  })
}
