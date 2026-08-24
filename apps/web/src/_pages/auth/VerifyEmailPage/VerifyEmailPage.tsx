import { useTranslations } from 'next-intl'

import { VerifyEmailStatus } from '@/features/auth-verify-email'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'

interface VerifyEmailPageProps {
  /** The `?token=` query param the route file read from the URL. */
  token?: string
}

export function VerifyEmailPage({ token }: VerifyEmailPageProps) {
  const t = useTranslations('auth')

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle as="h1" className="text-2xl">
          {t('verifyEmailTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VerifyEmailStatus token={token} />
      </CardContent>
    </Card>
  )
}
