import { useTranslations } from 'next-intl'

import { ResetPasswordForm } from '@/features/auth-reset-password'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

interface ResetPasswordPageProps {
  /** The `?token=` query param the route file read from the URL. */
  token?: string
}

export function ResetPasswordPage({ token }: ResetPasswordPageProps) {
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
        <ResetPasswordForm token={token} />
      </CardContent>
    </Card>
  )
}
