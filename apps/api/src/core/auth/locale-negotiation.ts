import accepts from 'accepts'
import type { Request } from 'express'

import { SUPPORTED_LOCALES, type SupportedLocale } from '@amcore/shared'

/**
 * Resolve a supported locale from the request `Accept-Language` header using
 * The same accepts parser used by Express's RFC-4647 negotiation, restricted
 * to {@link SUPPORTED_LOCALES}. Returns `undefined` when there is nothing usable
 * to negotiate, so callers fall through to the DB default rather than this
 * helper hard-coding it.
 *
 * A genuinely absent or blank `Accept-Language` returns `undefined` explicitly:
 * `acceptsLanguages` would otherwise treat a missing header as "all offered
 * languages acceptable" and return the first one, silently coupling the result
 * to whichever locale happens to be listed first / the current DB default. A
 * present header that matches no supported locale also returns `undefined`.
 *
 * Used as a creation-time hint only (registration, first OAuth login). An
 * explicitly stored preference always wins thereafter.
 */
export function negotiateLocale(req: Request): SupportedLocale | undefined {
  const header = req.headers['accept-language']
  if (!header || header.trim() === '') return undefined

  const match = accepts(req).languages(...SUPPORTED_LOCALES)
  return match ? (match as SupportedLocale) : undefined
}
