import { headers } from 'next/headers'

import { ADMIN_CONSOLE_CONFIG } from './admin-console.generated'
import { getConsoleOrigin } from './admin-console-config'
import { productAdminOrigins } from './product-admin-config.server'
import { hostMatchesOrigin } from './seo/host-matches-origin'

import 'server-only'

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
