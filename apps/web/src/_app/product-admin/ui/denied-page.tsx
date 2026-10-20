'use client'

import { useLocale, useTranslations } from 'next-intl'
import {
  coerceSupportedLocale,
  localizedFrontendUrl,
  PRODUCT_ADMIN_CONFIG,
  productAdminPath,
} from '@amcore/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { authActions } from '@/shared/api/auth-api'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button, buttonVariants } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

const actions = authActions('/product-admin/auth')

/** No profile, organization, or membership fetch is needed to leave a denied page. */
export function ProductAdminDenied({
  siteOrigin,
  showOrganizationList = true,
}: {
  siteOrigin: string
  showOrganizationList?: boolean
}) {
  const t = useTranslations('productAdmin')
  const auth = useTranslations('auth')
  const locale = coerceSupportedLocale(useLocale())
  const router = useRouteProgressRouter()
  const cache = useQueryClient()
  const logout = useMutation({
    mutationFn: actions.logout,
    retry: false,
    onSuccess: () => {
      cache.clear()
      router.replace(productAdminPath('/login'))
    },
  })
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle as="h1">{t('unavailableTitle')}</CardTitle>
        <CardDescription>{t('unavailableHelp')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ApiErrorAlert error={logout.error} />
        {showOrganizationList && (
          <RouteProgressLink
            href={`${productAdminPath('/organizations')}?view=list`}
            className={buttonVariants()}
          >
            {t('allOrganizations')}
          </RouteProgressLink>
        )}
        <div>
          {/* The website may use a separate host and browser session. */}
          <a
            href={localizedFrontendUrl(siteOrigin, locale, '/')}
            className="text-primary underline"
          >
            {t('visitSite')}
          </a>
        </div>
        <p className="text-sm text-muted-foreground">
          {t(PRODUCT_ADMIN_CONFIG.mode === 'path' ? 'sharedLogout' : 'separateLogout')}
        </p>
        <Button variant="outline" disabled={logout.isPending} onClick={() => logout.mutate()}>
          {auth('logout')}
        </Button>
      </CardContent>
    </Card>
  )
}
