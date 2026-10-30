import type { BrowserRequestBinding } from '../../../core/auth/mfa/browser-binding.js'
import { refreshSessionChanged } from '../../../core/auth/mfa/mfa-refresh-authority.js'
import {
  browserSessionContext,
  type BrowserSessionContextService,
} from '../../../core/frontend-context/browser-session-context.service.js'

export interface BoardAuthRequest {
  headers: Record<string, string | string[] | undefined>
}

/** Mounted raw-node middleware does not pass through Nest's frontend-context guard. */
export function boardBrowserBinding(
  contexts: BrowserSessionContextService,
  request: BoardAuthRequest = { headers: {} }
): BrowserRequestBinding | null {
  contexts.verify(request, request.headers)
  const context = browserSessionContext(request)
  if (context && !context.binding) throw refreshSessionChanged()
  return context?.binding ?? null
}
