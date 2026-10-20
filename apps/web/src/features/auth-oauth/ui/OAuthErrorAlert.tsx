import { useTranslations } from 'next-intl'

import { oauthLoginErrors } from '@/shared/lib/oauth-login-errors'
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

/** Only wired OAuth codes may select localized messages. Unknown query values stay invisible. */
export function OAuthErrorAlert({ code, className }: OAuthErrorAlertProps) {
  const t = useTranslations('errors')
  const normalized = Array.isArray(code) ? code[0] : code

  if (!normalized || !oauthLoginErrors.has(normalized)) return null

  return (
    <Alert variant="destructive" className={className}>
      <AlertDescription>{t(normalized as Parameters<typeof t>[0])}</AlertDescription>
    </Alert>
  )
}
