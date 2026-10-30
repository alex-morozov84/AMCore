import { ContextRequestError } from '@/shared/api/bff/context-errors'
import type { ProductWebContext } from '@/shared/api/bff/product-web-context.server'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'
import { getConsoleOrigin } from '@/shared/lib/admin-console-config'
import { isConsoleHost } from '@/shared/lib/console-host-guard'
import { productAdminDeployment } from '@/shared/lib/product-admin-config.server'

import { CONSOLE_SESSION_COOKIE_NAME, consoleSessionCookieOptions } from './session-cookie'
import { redisConsoleVaultLock } from './session-lock'
import { redisConsoleVaultStore } from './session-vault-store'

import 'server-only'

/** Literal Console routes and the configured HTTPS host select an isolated browser audience. */
export function consoleBrowserContext(request: Request): ProductWebContext {
  if (ADMIN_CONSOLE_CONFIG.mode !== 'host' || !isConsoleHost(request.headers.get('host')))
    throw new ContextRequestError(404, 'NOT_FOUND')
  const deployment = productAdminDeployment()
  return {
    frontend: 'site',
    audience: 'console',
    origin: getConsoleOrigin()!,
    siteOrigin: deployment.site,
    placementFingerprint: deployment.placementFingerprint,
    cookieName: CONSOLE_SESSION_COOKIE_NAME,
    cookieOptions: consoleSessionCookieOptions(),
    namespace: 'web:console-session:v1',
    store: redisConsoleVaultStore,
    lock: redisConsoleVaultLock,
    loginPath: '/login',
    entryPath: '/',
    apiHeaders: {},
  }
}
