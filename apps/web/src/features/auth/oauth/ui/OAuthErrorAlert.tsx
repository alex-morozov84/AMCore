import { useTranslations } from 'next-intl'
import { AuthErrorCode } from '@amcore/shared'

import { Alert, AlertDescription } from '@/shared/ui/alert'

interface OAuthErrorAlertProps {
  /**
   * The raw `?oauthError=` query value, if the OAuth callback redirected
   * here on failure. Next's `searchParams` types a repeated query param as
   * `string[]` (e.g. `?oauthError=A&oauthError=B`) — normalized to its
   * first value below, same as any other single-value query param would be.
   */
  code?: string | string[]
  className?: string
}

/**
 * OAuth-specific codes this alert is allowed to show — an **explicit
 * allowlist**, not "any code the `errors` catalogue happens to translate."
 * `code` arrives as a plain, user-editable query parameter: `t.has()` alone
 * would let `?oauthError=INVALID_CREDENTIALS` (a real, translated, but
 * completely unrelated code) render as if it were an OAuth failure. Today
 * this holds exactly one entry because `oauth-exchange-handler.ts` only
 * ever sets `OAUTH_TICKET_INVALID` on this param — extend it only when
 * another code is actually wired to redirect here.
 */
const OAUTH_QUERY_ERROR_ALLOWLIST: ReadonlySet<string> = new Set([
  AuthErrorCode.OAUTH_TICKET_INVALID,
])

/**
 * Surfaces an OAuth callback failure (e.g. `oauth-exchange-handler.ts`'s
 * `OAUTH_TICKET_INVALID` redirect) as localized text.
 *
 * Deliberately different from `ApiErrorAlert`/`useApiError`: those always
 * render a generic fallback for an unrecognized code, which is correct for
 * a real thrown API error but wrong here — an unknown or unrelated value (a
 * stale link, a typo, someone poking at the URL) should be silently ignored
 * rather than greeting the user with an error for a string they can
 * trivially forge or that has nothing to do with OAuth.
 */
export function OAuthErrorAlert({ code, className }: OAuthErrorAlertProps) {
  const t = useTranslations('errors')
  const normalized = Array.isArray(code) ? code[0] : code

  if (!normalized || !OAUTH_QUERY_ERROR_ALLOWLIST.has(normalized)) return null

  return (
    <Alert variant="destructive" className={className}>
      <AlertDescription>{t(normalized as Parameters<typeof t>[0])}</AlertDescription>
    </Alert>
  )
}
