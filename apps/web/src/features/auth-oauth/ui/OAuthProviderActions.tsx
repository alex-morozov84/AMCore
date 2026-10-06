'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/shared/ui/button'

export type OAuthActionProvider = 'google' | 'github' | 'apple'
export interface OAuthProviderActionsProps {
  providers: OAuthActionProvider[]
  busy: boolean
  onChoose(provider: OAuthActionProvider): void
}
const labels = { google: 'continueWithGoogle', github: 'continueWithGitHub', apple: 'continueWithApple' } as const

/** An explicit reservation action precedes navigation; no automatic provider start on render. */
export function OAuthProviderActions({ providers, busy, onChoose }: OAuthProviderActionsProps) {
  const t = useTranslations('auth')
  if (providers.length === 0) return null
  return <div className="space-y-3">
    {[...new Set(providers)].map(provider => <Button key={provider} variant="outline" className="w-full"
      disabled={busy} onClick={() => onChoose(provider)}>{t(labels[provider])}</Button>)}
    <p className="text-center text-xs text-muted-foreground">{t('orContinueWith')}</p>
  </div>
}
