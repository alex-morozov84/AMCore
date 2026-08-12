import { cookies } from 'next/headers'
import { vi } from 'vitest'

export function mockCookieStore(sessionId: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn().mockReturnValue(sessionId ? { value: sessionId } : undefined),
  } as never)
}

export function makeRequest(pathAndQuery: string, init: RequestInit = {}): Request {
  return new Request(`http://next.internal/api/${pathAndQuery}`, init)
}
