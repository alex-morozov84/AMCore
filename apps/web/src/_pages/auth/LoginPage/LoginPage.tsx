import { useTranslations } from 'next-intl'

import { LoginForm } from '@/features/auth-login'
import { OAuthErrorAlert, OAuthSection } from '@/features/auth-oauth'
import { Link } from '@/i18n/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

interface LoginPageProps {
  oauthProviders: string[]
  /** The raw `?oauthError=` query value — see `OAuthErrorAlert` for normalization/allowlisting. */
  oauthError?: string | string[]
}

export function LoginPage({ oauthProviders, oauthError }: LoginPageProps) {
  const t = useTranslations('auth')

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle as="h1" className="text-2xl">
          {t('login')}
        </CardTitle>
        <CardDescription>{t('loginSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <OAuthErrorAlert code={oauthError} className="mb-4" />
        <OAuthSection providers={oauthProviders} />
        <LoginForm />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t('noAccount')}{' '}
          {/* `underline`, not `hover:underline`: a link inside body text needs
          a non-color way to be told apart from plain text at rest, not only
          on hover/focus (axe `link-in-text-block`) — this text/link pair is
          also below the 3:1 contrast ratio the color-only cue would need. */}
          <Link href="/register" className="text-primary underline">
            {t('register')}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
