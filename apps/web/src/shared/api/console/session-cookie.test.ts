import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { CONSOLE_SESSION_COOKIE_NAME, consoleSessionCookieOptions } from './session-cookie'

describe('console session cookie', () => {
  it('uses a host-only __Host- cookie shape', () => {
    expect(CONSOLE_SESSION_COOKIE_NAME).toBe('__Host-amcore_console_session')
    expect(consoleSessionCookieOptions()).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    })
    expect(consoleSessionCookieOptions()).not.toHaveProperty('domain')
  })
})
