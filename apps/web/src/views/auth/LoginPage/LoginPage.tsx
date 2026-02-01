import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { LoginForm } from '@/features/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui'

export function LoginPage() {
  const t = useTranslations('auth')

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{t('login')}</CardTitle>
        <CardDescription>Войдите в свой аккаунт</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Нет аккаунта?{' '}
          <Link href="/register" className="text-accent hover:underline">
            {t('register')}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
