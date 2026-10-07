import { ZodError } from 'zod'

import { ContextRequestError } from './context-errors'
import { contextRoute } from './context-route'
import { InvitationBackendError } from './invitation-upstream'

import 'server-only'

/** Dedicated family contains upstream diagnostics and applies privacy headers on every outcome. */
export async function invitationRoute(
  request: Request,
  work: () => Promise<unknown>,
  successStatus: 200 | 201 | 202 = 200
) {
  const response = await contextRoute(
    request,
    async () => {
      try {
        return await work()
      } catch (error) {
        if (error instanceof ZodError) throw new ContextRequestError(400, 'BAD_REQUEST')
        if (error instanceof InvitationBackendError)
          throw new ContextRequestError(
            error.knownRejection ? error.status : 503,
            error.errorCode ?? 'INTERNAL_SERVER_ERROR',
            error.retryAfterSeconds
          )
        throw error
      }
    },
    successStatus
  )
  response.headers.set('referrer-policy', 'no-referrer')
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  return response
}
