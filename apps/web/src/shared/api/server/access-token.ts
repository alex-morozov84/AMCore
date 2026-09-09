import { getOptionalSessionEntry } from '../bff'

import 'server-only'

/**
 * The current visitor's live backend access token, when one exists —
 * reuses `dal.ts`'s own session-vault resolution/refresh (ADR-068) rather
 * than a second copy. Returns `null` for an anonymous visitor; callers that
 * require auth check for `null` themselves (this module has no opinion on
 * whether a given request needs one).
 */
export async function getBackendAccessToken(): Promise<string | null> {
  const entry = await getOptionalSessionEntry()
  return entry?.accessToken ?? null
}
