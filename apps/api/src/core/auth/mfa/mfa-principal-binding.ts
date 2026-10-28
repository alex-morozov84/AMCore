import type { RequestPrincipal } from '@amcore/shared'

import { browserSessionContext } from '../../frontend-context/browser-session-context.service.js'

import type { BrowserRequestBinding } from './browser-binding.js'

const bindings = new WeakMap<RequestPrincipal, BrowserRequestBinding>()

/** Attach only the normalized private transport to the final request-local principal. */
export function bindMfaPrincipal(request: object, principal: RequestPrincipal): void {
  bindings.delete(principal)
  const binding = browserSessionContext(request)?.binding
  if (principal.type === 'jwt' && binding) bindings.set(principal, binding)
}

/** A copied principal has no browser evidence; callers must keep the admitted request identity. */
export function principalBrowserBinding(principal: RequestPrincipal): BrowserRequestBinding | null {
  return bindings.get(principal) ?? null
}
