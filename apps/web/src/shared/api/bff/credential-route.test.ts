// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { isCredentialRoute } from './credential-route'

vi.mock('server-only', () => ({}))

describe('effective credential pathname', () => {
  it.each([
    'auth/login',
    'auth/register',
    'auth/refresh',
    'auth/step-up',
    'auth/oauth/exchange',
    'organizations/OrgID/switch',
    'Auth/LOGIN',
    'AUTH/OAUTH/EXCHANGE',
    'Organizations/x%2Fy/Switch',
    'auth/login/',
    'auth/../auth/login',
    'x/../auth/login',
    'auth/./login',
    'x/%2e%2e/auth/login',
    '../v1/auth/login',
  ])('denies %s after URL resolution', (path) => {
    expect(isCredentialRoute(new URL(`http://api/api/v1/${path}?ignored=1`))).toBe(true)
  })

  it.each([
    'auth/me',
    'auth/logins',
    'auth/login/extra',
    'auth%2Flogin',
    'auth/%256cogin',
    'auth/%6cogin',
    'organizations/id/switching',
    'organizations/id/extra/switch',
    'organizations//switch',
    'auth/oauth/providers',
    'api-keys',
    'auth/login//',
  ])('preserves unrelated raw pathname %s', (path) => {
    expect(isCredentialRoute(new URL(`http://api/api/v1/${path}?route=auth/login`))).toBe(false)
  })
})
