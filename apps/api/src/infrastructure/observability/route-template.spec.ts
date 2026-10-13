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
  it('uses native route metadata without leaking parameters or query values', () => {
    expect(
      normalizeRouteTemplate({
        url: '/api/v1/files/private-id?token=private-token',
        routeOptions: { url: '/api/v1/files/:id' },
      } as unknown as Request)
    ).toBe('/api/v1/files/:id')
  })

  it('keeps native unmatched requests in one bounded label', () => {
    expect(
      normalizeRouteTemplate({
        url: '/api/v1/private-id?token=private-token',
        routeOptions: {},
      } as unknown as Request)
    ).toBe('unknown')
  })
})
