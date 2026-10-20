import { useTranslations } from 'next-intl'

import { OAuthCompletionSubmit } from '@/features/auth-oauth'
import type { OAuthCompletionInput } from '@/shared/api/bff/oauth-completion-input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Spinner } from '@/shared/ui/spinner'

export function OAuthCompletionPage({
  ticket,
  locale,
  action,
}: OAuthCompletionInput & {
  action: '/api/auth/oauth/complete' | '/api/product-admin/auth/oauth/complete'
}) {
  const t = useTranslations('auth.oauthCompletion')
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
            <span aria-hidden="true">
              <Spinner className="motion-reduce:animate-none" />
            </span>
            <CardTitle as="h1" className="text-2xl">
              {t('title')}
            </CardTitle>
          </div>
          <CardDescription>{t('help')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action={action}>
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="locale" value={locale} />
            <OAuthCompletionSubmit />
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
