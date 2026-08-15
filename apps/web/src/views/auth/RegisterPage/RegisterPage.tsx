import { useTranslations } from 'next-intl'

import { RegisterForm } from '@/features/auth'
import { OAuthSection } from '@/features/auth/oauth'
import { Link } from '@/i18n/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

interface RegisterPageProps {
  oauthProviders: string[]
}

export function RegisterPage({ oauthProviders }: RegisterPageProps) {
  const t = useTranslations('auth')

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle as="h1" className="text-2xl">
          {t('register')}
        </CardTitle>
        <CardDescription>{t('registerSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <OAuthSection providers={oauthProviders} />
        <RegisterForm />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t('hasAccount')}{' '}
          {/* `underline`, not `hover:underline`: a link inside body text needs
          a non-color way to be told apart from plain text at rest, not only
          on hover/focus (axe `link-in-text-block`) — this text/link pair is
          also below the 3:1 contrast ratio the color-only cue would need. */}
          <Link href="/login" className="text-primary underline">
            {t('login')}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
