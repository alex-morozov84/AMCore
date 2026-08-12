// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/bff/authenticated-proxy', () => ({ proxyToBackend: vi.fn() }))

import * as route from './route'

// Next 16 Route Handlers 405 any HTTP method that isn't exported — GET/HEAD/
// OPTIONS are all treated as "safe" by authenticated-proxy.ts's CSRF check,
// so all three must actually be reachable, not just GET (round 2 finding).
describe('the [...path] catch-all route', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'exports a %s handler',
    (method) => {
      expect(typeof route[method as keyof typeof route]).toBe('function')
    }
  )
})
