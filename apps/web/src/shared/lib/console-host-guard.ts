import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { getConsoleOrigin } from './admin-console-config'
import { ADMIN_CONSOLE_CONFIG } from './admin-console-topology'
import { productAdminOrigins } from './product-admin-config.server'
import { hostMatchesOrigin } from './seo/host-matches-origin'

import 'server-only'

/**
 * First statement of every Console page, layout and metadata function. With the Console
 * turned off in `admin-console.json` the answer is 404 *before* any session, Redis, API or
 * other work starts: the check is synchronous, so no promise exists yet. A layout's own
 * refusal does not stop the pages beneath it from running, which is why each entrypoint
 * calls this itself. Route Handlers use `withConsoleHostGuard`, which answers a plain 404.
 */
export function requireConsoleEnabled(): void {
  if (!ADMIN_CONSOLE_CONFIG.enabled) notFound()
}

export function isConsoleHost(host: string | null): boolean {
  if (!ADMIN_CONSOLE_CONFIG.enabled) return false
  if (ADMIN_CONSOLE_CONFIG.mode !== 'host')
    return hostMatchesOrigin(host, productAdminOrigins().site)
  // Caddy preserves the public port; compare against the validated origin authority.
  return hostMatchesOrigin(host, getConsoleOrigin()!)
}

export async function hasCanonicalConsoleHost(): Promise<boolean> {
  return isConsoleHost((await headers()).get('host'))
}

export async function withConsoleHostGuard(
  request: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  if (!isConsoleHost(request.headers.get('host'))) return new Response(null, { status: 404 })
  return handler()
}
