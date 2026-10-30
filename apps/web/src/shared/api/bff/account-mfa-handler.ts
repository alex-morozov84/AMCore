import { mfaSettingsStartRecoverySchema } from '@amcore/shared'

import { readContextJson } from './context-body-budget'
import { ContextRequestError } from './context-errors'
import { commandPendingMfa, inspectPendingMfa } from './mfa-pending-handler'
import { inspectMfaSettings, resolveMfaSettingsStart } from './mfa-settings-handler'
import type { ProductWebContext } from './product-web-context.server'
import { isProductMutationTrusted } from './product-web-context.server'

import 'server-only'

/** Caller selects hostname/audience and checks mutation origin before entering this composition. */
export async function handleAccountMfa(
  request: Request,
  context: ProductWebContext,
  startStatus = false
) {
  if (request.method !== 'GET') {
    if (!isProductMutationTrusted(request, context))
      throw new ContextRequestError(403, 'AUTH_ORIGIN_REJECTED')
    if (startStatus) {
      const input = mfaSettingsStartRecoverySchema.parse(await readContextJson(request.body, 2048))
      return resolveMfaSettingsStart(request, context, {
        operationId: input.operationId,
        action: input.purpose === 'replace_factor' ? 'start_replacement' : 'start_code_rotation',
      })
    }
    return commandPendingMfa(request, context)
  }
  if (startStatus) throw new ContextRequestError(405, 'METHOD_NOT_ALLOWED')
  // Settings belongs to the current primary session. An obsolete pending cookie
  // cannot select an old continuation or prevent reading admitted settings.
  if (request.headers.get('x-amcore-mfa-flow')) return inspectPendingMfa(request, context)
  return inspectMfaSettings(request, context)
}
