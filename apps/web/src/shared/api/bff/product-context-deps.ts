import { cookies } from 'next/headers'

import { getBackendBaseUrl } from '../backend-transport'

import { createBrowserBindingVerifier } from './browser-binding.server'
import type { ContextExecutorDeps } from './context-executor'
import { type ProductRouteKind, resolveProductWebContext } from './product-web-context.server'
import { createUpstreamRefresh } from './upstream-refresh'

import 'server-only'

export function productContextDeps(
  source: Headers,
  kind: ProductRouteKind = 'product-data'
): ContextExecutorDeps {
  const context = resolveProductWebContext(source, kind)
  return {
    webContext: context,
    expectedAudience: context.audience,
    readSessionId: async () => (await cookies()).get(context.cookieName)?.value,
    apiBase: getBackendBaseUrl(),
    store: context.store,
    lock: context.lock,
    upstreamRefresh: createUpstreamRefresh(source, context),
    verifyBinding: createBrowserBindingVerifier(source, context.audience),
  }
}
