import type { SessionsListResponse } from '@amcore/shared'
import { http, HttpResponse } from 'msw'

/**
 * Default happy-path handlers for the same-origin `/api/*` BFF surface
 * (ADR-068). Individual tests override with `server.use(...)` for the
 * specific response shape they're asserting — these exist so a test that
 * doesn't care about a given endpoint still gets a well-formed response
 * instead of an unhandled-request warning.
 */
export const handlers = [
  http.get('/api/auth/sessions', () => {
    const body: SessionsListResponse = { data: [], total: 0, page: 1, limit: 20 }
    return HttpResponse.json(body)
  }),
]
