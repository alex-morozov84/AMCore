import { getTranslations } from 'next-intl/server'
import { productAdminPath } from '@amcore/shared'

import { getOptionalSession } from '@/shared/api/bff/dal'
import { buttonVariants } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import 'server-only'

/** A display-only callback result; it never changes identity, membership, or permissions. */
export async function ProductAdminLinkedPage({ linked }: { linked?: string | string[] }) {
  const t = await getTranslations('productAdmin')
  const known =
    typeof linked === 'string' && ['google', 'github', 'apple', 'telegram'].includes(linked)
  const signedIn = await getOptionalSession('admin-auth')
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle as="h1">{t(known && signedIn ? 'linkedTitle' : 'linkFailedTitle')}</CardTitle>
        <CardDescription>{t(known && signedIn ? 'linkedHelp' : 'linkFailedHelp')}</CardDescription>
      </CardHeader>
      <CardContent>
        <RouteProgressLink
          href={productAdminPath(signedIn ? '/organizations' : '/login')}
          className={buttonVariants()}
        >
          {t(signedIn ? 'returnToAdmin' : 'returnToLogin')}
        </RouteProgressLink>
      </CardContent>
    </Card>
  )
}
