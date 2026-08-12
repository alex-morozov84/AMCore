import { cache } from 'react'
import { cookies } from 'next/headers'
import type { Locale } from 'next-intl'
import { getLocale } from 'next-intl/server'
import type { UserResponse } from '@amcore/shared'

import { redirect } from '@/i18n/navigation'

import { ensureFreshSession } from './ensure-fresh-session'
import { isInvalidRefreshError, SessionNotFoundError, SessionRefreshUnsafeError } from './errors'
import { SESSION_COOKIE_NAME } from './session-cookie'
import { redisVaultLock } from './session-lock'
import { redisVaultStore } from './session-vault-store'
import { upstreamRefresh } from './upstream-refresh'

import 'server-only'

export interface DalSession {
  user: UserResponse
}

/**
 * Data Access Layer (Next's own recommended auth pattern — see
 * `apps/web/node_modules/next/dist/docs/01-app/02-guides/authentication.md`
 * "Creating a Data Access Layer (DAL)"). `cache()`-wrapped so several Server
 * Components on one page share a single Redis round-trip per request
 * instead of one each.
 *
 * Splits errors exactly like `authenticated-proxy.ts`'s
 * `authFailureResponse` (round 2 of that slice's review): "no session"
 * (missing cookie, `SessionNotFoundError`, an explicit invalid/reuse-detected
 * refresh, or lost refresh exclusivity) resolves to `null` — genuinely
 * logged out. Everything else (Redis unreachable, lock contention, a
 * transient upstream refresh failure) **rethrows**: auth could not be
 * *proven* one way or the other, which callers must not silently treat as
 * "logged out" (see `requireSession` and `(dashboard)/error.tsx`).
 */
export const getOptionalSession = cache(async (): Promise<DalSession | null> => {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  if (!sessionId) return null

  try {
    const entry = await ensureFreshSession(sessionId, {
      store: redisVaultStore,
      lock: redisVaultLock,
      upstreamRefresh,
    })
    return { user: entry.userSnapshot }
  } catch (error) {
    if (
      error instanceof SessionNotFoundError ||
      error instanceof SessionRefreshUnsafeError ||
      isInvalidRefreshError(error)
    ) {
      return null
    }
    throw error
  }
})

/**
 * The real gate for protected pages — call this in the page itself, not
 * only the layout. Layouts don't re-render on client-side navigation
 * between sibling routes underneath them, so a check that only lives there
 * stops being a real gate the moment a second protected page exists.
 *
 * Redirects to the localized login page when there is no session.
 * Rethrows, does **not** redirect, when `getOptionalSession` couldn't prove
 * auth one way or the other — a Redis blip must surface as "temporarily
 * unavailable" (an error boundary), never as a false "you're logged out."
 */
export const requireSession = cache(async (): Promise<DalSession> => {
  const session = await getOptionalSession()
  if (!session) {
    return redirect({ href: '/login', locale: await getLocale() })
  }
  return session
})

/**
 * For auth pages only (login/register): redirects to `/` if a session
 * already exists. Fails open on any error, including vault-unavailable —
 * unlike `requireSession`, there is no security downside to rendering a
 * login form to someone who might already be logged in; blocking the form
 * during a Redis blip would be a strictly worse outcome for a page whose
 * only job is to let someone authenticate.
 */
export async function redirectIfAuthenticated(locale: Locale): Promise<void> {
  let session: DalSession | null
  try {
    session = await getOptionalSession()
  } catch (error) {
    console.error('[auth pages] session read failed, rendering the form anyway', error)
    return
  }
  if (session) {
    redirect({ href: '/', locale })
  }
}
