import { useTranslations } from 'next-intl'

import { ForgotPasswordForm } from '@/features/auth-forgot-password'
import { Link } from '@/i18n/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

export function ForgotPasswordPage() {
  const t = useTranslations('auth')

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle as="h1" className="text-2xl">
          {t('forgotPasswordTitle')}
        </CardTitle>
        <CardDescription>{t('forgotPasswordSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {/* `underline`, not `hover:underline` — see LoginPage/RegisterPage's
          identical link-in-text-block reasoning. */}
          <Link href="/login" className="text-primary underline">
            {t('backToLogin')}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
