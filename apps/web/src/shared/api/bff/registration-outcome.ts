import type { NextResponse } from 'next/server'
import { AuthErrorCode } from '@amcore/shared'

import { apiErrorResponse } from './api-error-response'
import { ContextRequestError } from './context-errors'

import 'server-only'

/**
 * Registration was confirmed by the API (exact `201` + valid body) but the browser
 * session could not be published. The account exists: the caller must sign in.
 * `503` keeps the BFF "temporarily unavailable" class; the code carries the truth.
 * No cookie, no user body and no `Retry-After`: repeating the POST cannot help.
 */
const MESSAGE = 'Registration completed; sign-in is temporarily unavailable'

export function registrationSignInRequiredResponse(request: Request): NextResponse {
  return apiErrorResponse(request, {
    statusCode: 503,
    message: MESSAGE,
    errorCode: AuthErrorCode.REGISTRATION_SIGN_IN_REQUIRED,
  })
}

/**
 * Wraps the WHOLE deadline-bounded invitation work from outside its race. Once
 * `created()` reports API evidence, any failure — including an outer abort that wins
 * while inner cleanup is still awaiting — means no session was published, so the
 * caller gets the created-account code. The marker is read here, at classification
 * time; a late upstream result cannot revise a response that was already returned.
 */
export async function withCreatedOutcome<T>(
  created: () => boolean,
  work: () => Promise<T>
): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (created()) throw new ContextRequestError(503, AuthErrorCode.REGISTRATION_SIGN_IN_REQUIRED)
    throw error
  }
}
