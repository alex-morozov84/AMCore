import { useTranslations } from 'next-intl'

import { ResetPasswordForm } from '@/features/auth-reset-password'
import type { AuthActionBase } from '@/shared/api/auth-api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

interface ResetPasswordPageProps {
  /** The `?token=` query param the route file read from the URL. */
  token?: string
  actionBase?: AuthActionBase
  loginHref?: string
  forgotPasswordHref?: string
}

export function ResetPasswordPage(props: ResetPasswordPageProps) {
  const t = useTranslations('auth')

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle as="h1" className="text-2xl">
          {t('resetPasswordTitle')}
        </CardTitle>
        <CardDescription>{t('resetPasswordSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm {...props} />
      </CardContent>
    </Card>
  )
}
