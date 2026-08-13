import { useTranslations } from 'next-intl'

import { Button } from '@/shared/ui/button'

interface OAuthSectionProps {
  /** The backend's currently-configured provider list (`getOAuthProviders()`). */
  providers: string[]
}

/**
 * The OAuth entry point above the email/password form. Renders nothing when
 * Google isn't configured — not a disabled button: this is an end-user auth
 * screen, not an operator console, so an unavailable sign-in method should
 * not be visible at all (how to enable it belongs in docs, not the UI).
 *
 * A plain `<a>` (via Base UI's `render` composition, not a client
 * click-handler): the flow is a real server redirect chain to Google, so
 * this must be a full page navigation, and an anchor gets correct
 * right-click/open-in-new-tab/keyboard behavior for free.
 */
export function OAuthSection({ providers }: OAuthSectionProps) {
  const t = useTranslations('auth')

  if (!providers.includes('google')) return null

  // `next/link` does client-side routing meant for internal pages; it cannot
  // guarantee the hard, full-document navigation this redirect-to-Google
  // chain requires, so a plain anchor is correct here, not a lint gap.
  // eslint-disable-next-line @next/next/no-html-link-for-pages
  const googleLink = <a href="/api/auth/oauth/google">{t('continueWithGoogle')}</a>

  return (
    <div className="mb-4 space-y-4">
      <Button render={googleLink} variant="outline" className="w-full" />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        {t('orContinueWith')}
        <div className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}
