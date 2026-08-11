import { VAULT_TTL_SECONDS } from './vault-constants'

import 'server-only'

/**
 * The only cookie the browser ever holds for the web app's authenticated
 * state (ADR-068) — an opaque, Next-issued session id. Never the backend's
 * own `refresh_token` or an access token in any form.
 */
export const SESSION_COOKIE_NAME = 'amcore_session'

export interface SessionCookieOptions {
  httpOnly: true
  secure: boolean
  sameSite: 'strict'
  path: string
  maxAge: number
}

/** Mirrors `apps/api`'s own cookie options shape (`AuthController.cookieOptions`). */
export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: VAULT_TTL_SECONDS,
  }
}
