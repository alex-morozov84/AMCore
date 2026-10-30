import { authFailureResponse } from '@/shared/api/bff/auth-failure-response'
import { logoutConsoleReturnEntry } from '@/shared/api/bff/console-return-entry'
import { handleLogout } from '@/shared/api/bff/logout-handler'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { consoleBrowserContext } from './browser-context'
import { consolePersonalMutation } from './personal-mutation-route'

import 'server-only'

/** The observed page intent and current browser generation must agree before logout or cookie clearing. */
export async function handleConsoleLogout(request: Request): Promise<Response> {
  if (request.headers.get('x-amcore-return-entry'))
    return consolePersonalMutation(request, (context) => logoutConsoleReturnEntry(request, context))
  if (ADMIN_CONSOLE_CONFIG.mode === 'path')
    return consolePersonalMutation(request, (context) => handleLogout(request, context))
  try {
    return await handleLogout(request, consoleBrowserContext(request))
  } catch (error) {
    return authFailureResponse(request, error)
  }
}
