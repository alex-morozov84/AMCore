import { cookies } from 'next/headers'

import type { ContextExecutorDeps } from '@/shared/api/bff/context-executor'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'
import { createUpstreamRefresh } from '@/shared/api/bff/upstream-refresh'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { CONSOLE_SESSION_COOKIE_NAME } from './session-cookie'
import { redisConsoleVaultLock } from './session-lock'
import { redisConsoleVaultStore } from './session-vault-store'

import 'server-only'

export function establishmentConsoleDeps(headers: Headers): ContextExecutorDeps {
  if (ADMIN_CONSOLE_CONFIG.mode !== 'host') return productContextDeps(headers, 'site-auth')
  return {
    readSessionId: async () => (await cookies()).get(CONSOLE_SESSION_COOKIE_NAME)?.value,
    apiBase: process.env.API_URL ?? 'http://localhost:5002',
    store: redisConsoleVaultStore,
    lock: redisConsoleVaultLock,
    upstreamRefresh: createUpstreamRefresh(headers),
  }
}
