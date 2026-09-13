import { useTranslations } from 'next-intl'

import { ConsoleLoginForm } from '@/features/console-login'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

export function ConsoleLoginPage() {
  const t = useTranslations('console')

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('loginTitle')}</CardTitle>
          <CardDescription>{t('loginDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ConsoleLoginForm />
        </CardContent>
      </Card>
    </main>
  )
}
