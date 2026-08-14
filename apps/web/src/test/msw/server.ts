import { setupServer } from 'msw/node'

import { handlers } from './handlers'

/**
 * Intercepts same-origin `/api/*` requests in Vitest's `jsdom` environment.
 * `msw/node`, not `msw/browser`: `setupWorker()` registers a real Service
 * Worker, which `jsdom` doesn't implement — `setupServer()` patches the
 * network client directly (`@mswjs/interceptors`) and works the same way
 * regardless of environment. This is the layer FINAL PLAN §1 calls
 * "browser-side" because of *what* it tests (the same-origin `/api/*`
 * boundary a real browser hits), not the MSW entry point it uses.
 */
export const server = setupServer(...handlers)
