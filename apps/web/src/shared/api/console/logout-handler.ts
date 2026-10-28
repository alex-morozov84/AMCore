import { authFailureResponse } from '@/shared/api/bff/auth-failure-response'
import { handleLogout } from '@/shared/api/bff/logout-handler'

import { consoleBrowserContext } from './browser-context'

import 'server-only'

/** The observed page intent and current browser generation must agree before logout or cookie clearing. */
export async function handleConsoleLogout(request: Request): Promise<Response> {
  try {
    return await handleLogout(request, consoleBrowserContext(request))
  } catch (error) {
    return authFailureResponse(request, error)
  }
}
