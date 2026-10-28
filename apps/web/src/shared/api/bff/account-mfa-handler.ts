import { readBrowserAuthAttempt } from './browser-auth-attempt'
import { ContextRequestError } from './context-errors'
import { commandPendingMfa, inspectPendingMfa } from './mfa-pending-handler'
import { inspectMfaSettings } from './mfa-settings-handler'
import type { ProductWebContext } from './product-web-context.server'
import { isProductMutationTrusted } from './product-web-context.server'

import 'server-only'

/** Caller selects hostname/audience and checks mutation origin before entering this composition. */
export async function handleAccountMfa(request: Request, context: ProductWebContext) {
  if (request.method !== 'GET') {
    if (!isProductMutationTrusted(request, context))
      throw new ContextRequestError(403, 'AUTH_ORIGIN_REJECTED')
    return commandPendingMfa(request, context)
  }
  const pending = await readBrowserAuthAttempt(request.headers, context)
  if (
    request.headers.get('x-amcore-mfa-flow') ||
    (pending &&
      'flow' in pending.record &&
      pending.record.state !== 'published' &&
      pending.record.flow.state !== 'completed')
  )
    return inspectPendingMfa(request, context)
  return inspectMfaSettings(request, context)
}
