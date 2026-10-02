'use client'

import { useTranslations } from 'next-intl'
import type { OrganizationContextResponse } from '@amcore/shared'

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'

export function OrganizationContextSummary({
  context,
  email,
}: {
  context: OrganizationContextResponse
  email: string
}) {
  const t = useTranslations('organizationAccess')
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('organization')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="break-words font-medium">{context.organization.name}</p>
          <dl>
            <dt className="text-sm text-muted-foreground">{t('slug')}</dt>
            <dd className="break-all">{context.organization.slug}</dd>
          </dl>
          <p className="break-all text-sm text-muted-foreground">{t('account', { email })}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('access')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl>
            <dt className="text-sm text-muted-foreground">{t('teamManagement')}</dt>
            <dd>
              {context.actorAffordances['teamAccess.manage'] === 'allowed'
                ? t('permitted')
                : t('notPermitted')}
            </dd>
          </dl>
          <p className="text-sm text-muted-foreground">{t('readOnlyCaveat')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
