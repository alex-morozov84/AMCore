import { useTranslations } from 'next-intl'

import { cn } from '@/shared/lib/utils'
import { buttonVariants } from '@/shared/ui/button'

interface OAuthSectionProps {
  /** The backend's currently-configured provider list (`getOAuthProviders()`). */
  providers: string[]
  links?: Partial<Record<'google' | 'github' | 'apple', string>>
}

/**
 * Configured sign-in methods above the password form. The site's default
 * stays Google-only; application-owned links opt into other supported methods.
 * Unavailable methods stay hidden; operator configuration belongs in docs.
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
export function OAuthSection({ providers, links }: OAuthSectionProps) {
  const t = useTranslations('auth')

  const choices = links
    ? (['google', 'github', 'apple'] as const).filter(
        (provider) => providers.includes(provider) && links[provider]
      )
    : providers.includes('google')
      ? (['google'] as const)
      : []
  const labels = {
    google: 'continueWithGoogle',
    github: 'continueWithGitHub',
    apple: 'continueWithApple',
  } as const
  if (choices.length === 0) return null

  return (
    <div className="mb-4 space-y-4">
      {/* `next/link` does client-side routing meant for internal pages; it
      cannot guarantee the hard, full-document navigation this
      redirect-to-Google chain requires, so a plain anchor is correct here,
      not a lint gap. */}
      {choices.map((provider) => (
        <a
          key={provider}
          href={links?.[provider] ?? '/api/auth/oauth/google'}
          data-slot="button"
          data-variant="outline"
          data-size="default"
          className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
        >
          {t(labels[provider])}
        </a>
      ))}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        {t('orContinueWith')}
        <div className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}
