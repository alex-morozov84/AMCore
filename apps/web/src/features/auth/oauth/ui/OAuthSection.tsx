import { useTranslations } from 'next-intl'

import { cn } from '@/shared/lib/utils'
import { buttonVariants } from '@/shared/ui/button'

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
 * A plain `<a>` styled via `buttonVariants` — not Base UI's `Button` — the
 * flow is a real server redirect chain to Google, so this must be a full
 * page navigation and stay a real link (`role="link"`, correct right-click/
 * open-in-new-tab/keyboard behavior). `Button render={<a/>}` was tried
 * first and rejected: Base UI's `Button` defaults `nativeButton: true`
 * and warns when composed onto a non-`<button>` element; the documented
 * fix, `nativeButton={false}`, doesn't just silence the warning — Base UI
 * adds non-native button semantics (including `role="button"`) in that
 * mode, which is exactly the wrong role for a link. Sidestepping `Button`
 * entirely (styles only, via the same `buttonVariants` it uses
 * internally) keeps the real `<a>` semantics intact.
 */
export function OAuthSection({ providers }: OAuthSectionProps) {
  const t = useTranslations('auth')

  if (!providers.includes('google')) return null

  return (
    <div className="mb-4 space-y-4">
      {/* `next/link` does client-side routing meant for internal pages; it
      cannot guarantee the hard, full-document navigation this
      redirect-to-Google chain requires, so a plain anchor is correct here,
      not a lint gap. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/api/auth/oauth/google"
        data-slot="button"
        data-variant="outline"
        data-size="default"
        className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
      >
        {t('continueWithGoogle')}
      </a>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        {t('orContinueWith')}
        <div className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}
