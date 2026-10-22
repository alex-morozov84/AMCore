import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { VerifyEmailStatus } from '@/features/auth-verify-email'
import type { AuthActionBase } from '@/shared/api/auth-api'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'

interface VerifyEmailPageProps {
  /** The `?token=` query param the route file read from the URL. */
  token?: string
  actionBase?: AuthActionBase
  loginHref?: string
  homeHref?: string
  resendHref?: string
  withoutTokenContent?: ReactNode
  successContent?: ReactNode
}

export function VerifyEmailPage({
  token,
  withoutTokenContent,
  successContent,
  actionBase,
  loginHref = '/login',
  homeHref = '/',
  resendHref = '/resend-verification',
}: VerifyEmailPageProps) {
  const t = useTranslations('auth')

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle as="h1" className="text-2xl">
          {t('verifyEmailTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VerifyEmailStatus
          token={token}
          actionBase={actionBase}
          loginHref={loginHref}
          homeHref={homeHref}
          resendHref={resendHref}
          withoutTokenContent={withoutTokenContent}
          successContent={successContent}
        />
      </CardContent>
    </Card>
  )
}
