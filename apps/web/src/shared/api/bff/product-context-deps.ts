import { cookies } from 'next/headers'

import type { ContextExecutorDeps } from './context-executor'
import { SESSION_COOKIE_NAME } from './session-cookie'
import { redisVaultLock } from './session-lock'
import { redisVaultStore } from './session-vault-store'
import { createUpstreamRefresh } from './upstream-refresh'

import 'server-only'

export function productContextDeps(source: Headers): ContextExecutorDeps {
  return {
    readSessionId: async () => (await cookies()).get(SESSION_COOKIE_NAME)?.value,
    apiBase: process.env.API_URL ?? 'http://localhost:5002',
    store: redisVaultStore,
    lock: redisVaultLock,
    upstreamRefresh: createUpstreamRefresh(source),
  }
}
