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
    'auth/login//',
    'auth/%6cogin',
    'auth/%256cogin',
    'auth%2Flogin',
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
    'organizations/id/switching',
    'organizations/id/extra/switch',
    'organizations//switch',
    'auth/oauth/providers',
    'api-keys',
  ])('preserves unrelated effective pathname %s', (path) => {
    expect(isCredentialRoute(new URL(`http://api/api/v1/${path}?route=auth/login`))).toBe(false)
  })
})

describe('generic BFF invitation containment', () => {
  it.each([
    '/auth/invites',
    '/auth/invites/accept',
    '/auth/invites/register',
    '/auth/invites/continuations/context',
    '/auth/invites/auth-handoffs/attempt/abort',
    '/auth/%69nvites/inspect',
    '/AUTH/INVITES/operations/id',
    '/auth//invites/accept',
    '/auth/invites%2Faccept',
    '/auth/%2569nvites/accept',
  ])('closes every invitation capability, including encoded aliases: %s', (path) => {
    expect(isCredentialRoute(new URL(`https://api.example.com/api/v1${path}`))).toBe(true)
  })

  it('keeps ordinary authenticated routes available', () => {
    expect(isCredentialRoute(new URL('https://api.example.com/api/v1/auth/me'))).toBe(false)
    expect(isCredentialRoute(new URL('https://api.example.com/api/v1/notifications'))).toBe(false)
  })
})
