import { useTranslations } from 'next-intl'

import { RegisterForm } from '@/features/auth'
import { Link } from '@/i18n/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui'

export function RegisterPage() {
  const t = useTranslations('auth')

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{t('register')}</CardTitle>
        <CardDescription>{t('registerSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t('hasAccount')}{' '}
          <Link href="/login" className="text-primary hover:underline">
            {t('login')}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
