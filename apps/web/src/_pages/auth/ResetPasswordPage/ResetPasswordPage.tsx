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
      <CardContent className="px-0">
        <ResetPasswordForm
          {...props}
          header={
            <CardHeader className="text-center">
              <CardTitle as="h1" className="text-2xl">
                {t('resetPasswordTitle')}
              </CardTitle>
              <CardDescription>{t('resetPasswordSubtitle')}</CardDescription>
            </CardHeader>
          }
          successHeader={
            <CardHeader className="text-center">
              <CardTitle as="h1" className="text-2xl">
                {t('resetPasswordSuccessTitle')}
              </CardTitle>
            </CardHeader>
          }
        />
      </CardContent>
    </Card>
  )
}
