import { apiErrorResponse } from '@/shared/api/bff/api-error-response'
import { authFailureResponse } from '@/shared/api/bff/auth-failure-response'
import { getOptionalSessionEntry } from '@/shared/api/bff/dal'
import { isTrustedOrigin } from '@/shared/api/bff/origin-guard'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { isTrustedConsoleOrigin } from './origin-guard'
import { getConsoleSessionEntry } from './session'

import 'server-only'

export type ConsoleTokenResolution = { token: string } | { failure: Response }

/**
 * Resolves the operator's current access token the same way every console
 * read already does (`getConsoleAwareAccessToken`'s mode branch — isolated
 * console vault in host mode, the product session in path mode), but keeps
 * the underlying error type instead of collapsing it to `null` first, so a
 * genuine outage (`authFailureResponse`'s 503 branch) is distinguishable
 * from "no session" (401) at this mutation boundary.
 *
 * This is the reusable session/origin seam for console mutations (shared by
 * the role-change and step-up handlers today, and any future one); it deliberately
 * does not also stream a response — each caller's own success body has a
 * different sensitivity (an ordinary resource vs. a bearer token), so
 * forwarding stays each handler's own decision, not a one-size-fits-all
 * generic proxy.
 */
export async function resolveConsoleAccessToken(request: Request): Promise<ConsoleTokenResolution> {
  try {
    const entry =
      ADMIN_CONSOLE_CONFIG.mode === 'host'
        ? await getConsoleSessionEntry()
        : await getOptionalSessionEntry()
    if (!entry) {
      return {
        failure: apiErrorResponse(request, { statusCode: 401, message: 'Not authenticated' }),
      }
    }
    return { token: entry.accessToken }
  } catch (error) {
    return { failure: authFailureResponse(request, error) }
  }
}

/** Origin check for a non-safe-method console request, selected by topology:
 * the strict single-host check in host mode (own origin, own vault), the
 * product's configured-origins check in path mode (console shares the
 * product session and its CSRF boundary). */
export function isConsoleRequestOriginTrusted(request: Request): boolean {
  return ADMIN_CONSOLE_CONFIG.mode === 'host'
    ? isTrustedConsoleOrigin(request)
    : isTrustedOrigin(request)
}
