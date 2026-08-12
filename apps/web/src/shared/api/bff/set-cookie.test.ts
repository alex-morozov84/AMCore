// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { extractCookieValue } from './set-cookie'

// See ensure-fresh-session.basic.test.ts for why `server-only` needs mocking.
vi.mock('server-only', () => ({}))

function fakeResponse(setCookieHeaders: string[]): Response {
  return { headers: { getSetCookie: () => setCookieHeaders } } as unknown as Response
}

describe('extractCookieValue', () => {
  it('extracts a named cookie value from a single Set-Cookie header', () => {
    const response = fakeResponse(['refresh_token=rt-1; Path=/; HttpOnly; SameSite=Strict'])
    expect(extractCookieValue(response, 'refresh_token')).toBe('rt-1')
  })

  it('finds the named cookie among multiple Set-Cookie headers', () => {
    const response = fakeResponse(['other=ignored; Path=/', 'refresh_token=rt-1; Path=/'])
    expect(extractCookieValue(response, 'refresh_token')).toBe('rt-1')
  })

  it('returns null when the named cookie is absent', () => {
    const response = fakeResponse(['other=ignored; Path=/'])
    expect(extractCookieValue(response, 'refresh_token')).toBeNull()
  })

  it('returns null when there are no Set-Cookie headers at all', () => {
    expect(extractCookieValue(fakeResponse([]), 'refresh_token')).toBeNull()
  })

  it('falls back to headers.get("set-cookie") when getSetCookie is unavailable', () => {
    const response = {
      headers: { get: () => 'refresh_token=rt-1; Path=/' },
    } as unknown as Response
    expect(extractCookieValue(response, 'refresh_token')).toBe('rt-1')
  })
})
