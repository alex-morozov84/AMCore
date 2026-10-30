import { cookies } from 'next/headers'

import { createBrowserBindingVerifier } from '@/shared/api/bff/browser-binding.server'
import type { ContextExecutorDeps } from '@/shared/api/bff/context-executor'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'
import { createUpstreamRefresh } from '@/shared/api/bff/upstream-refresh'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { getBackendBaseUrl } from '../backend-transport'

import { CONSOLE_SESSION_COOKIE_NAME } from './session-cookie'
import { redisConsoleVaultLock } from './session-lock'
import { redisConsoleVaultStore } from './session-vault-store'

import 'server-only'

export function establishmentConsoleDeps(headers: Headers): ContextExecutorDeps {
  if (ADMIN_CONSOLE_CONFIG.mode !== 'host') return productContextDeps(headers, 'site-auth')
  return {
    readSessionId: async () => (await cookies()).get(CONSOLE_SESSION_COOKIE_NAME)?.value,
    apiBase: getBackendBaseUrl(),
    store: redisConsoleVaultStore,
    lock: redisConsoleVaultLock,
    upstreamRefresh: createUpstreamRefresh(headers, undefined, 'console'),
    expectedAudience: 'console',
    verifyBinding: createBrowserBindingVerifier(headers, 'console'),
  }
}
