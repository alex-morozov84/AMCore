import { headers } from 'next/headers'

import { ADMIN_CONSOLE_CONFIG } from './admin-console.generated'
import { getConsoleHostname } from './admin-console-config'

import 'server-only'

export function isConsoleHost(host: string | null): boolean {
  if (!ADMIN_CONSOLE_CONFIG.enabled) return false
  if (ADMIN_CONSOLE_CONFIG.mode !== 'host') return true
  return host === getConsoleHostname()
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
