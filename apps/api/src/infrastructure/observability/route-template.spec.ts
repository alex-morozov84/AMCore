import type { Request } from 'express'

import { normalizeRouteTemplate } from './route-template'

describe('normalizeRouteTemplate', () => {
  function req(input: Partial<Request> & { route?: { path?: unknown } }): Request {
    return input as Request
  }

  it('uses the Express route template with the global prefix', () => {
    expect(
      normalizeRouteTemplate(
        req({
          baseUrl: '',
          originalUrl: '/api/v1/organizations/abc123/members/user456',
          route: { path: '/api/v1/organizations/:orgId/members/:userId' },
        })
      )
    ).toBe('/api/v1/organizations/:orgId/members/:userId')
  })

  it('does not use raw baseUrl values when only a method path is available', () => {
    expect(
      normalizeRouteTemplate(
        req({
          baseUrl: '/api/v1/organizations/abc123/members',
          originalUrl: '/api/v1/organizations/abc123/members/user456',
          route: { path: ':userId' },
        })
      )
    ).toBe('/api/v1/:userId')
  })

  it('returns unmatched when Express did not match a route', () => {
    expect(
      normalizeRouteTemplate(
        req({
          baseUrl: '',
          originalUrl: '/api/v1/not-found/real-id',
        })
      )
    ).toBe('unmatched')
  })

  it('does not emit unsafe route internals', () => {
    expect(
      normalizeRouteTemplate(
        req({
          baseUrl: '/api/v1/files',
          originalUrl: '/api/v1/files/abc123',
          route: { path: '(.*)' },
        })
      )
    ).toBe('unknown')
  })
})
