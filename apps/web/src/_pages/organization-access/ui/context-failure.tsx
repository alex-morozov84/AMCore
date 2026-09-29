'use client'

import { useTranslations } from 'next-intl'

import type { OrganizationContextState } from '@/entities/organization-context'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

export function OrganizationAccessFailure({
  state,
  listHref,
  loginHref,
  onReload,
}: {
  state: OrganizationContextState
  listHref: string
  loginHref: string
  onReload: () => void
}) {
  const t = useTranslations('organizationAccess')
  if (state.status === 'error') return <ApiErrorAlert error={state.error} />
  return (
    <Alert>
      <AlertTitle>
        {state.status === 'denied'
          ? t('unavailableTitle')
          : state.status === 'missing'
            ? t('missingTitle')
            : t('changedTitle')}
      </AlertTitle>
      <AlertDescription className="gap-3">
        <p>
          {state.status === 'denied'
            ? t('unavailableGuidance')
            : state.status === 'missing'
              ? t('missingGuidance')
              : t('changedGuidance')}
        </p>
        {state.status === 'changed' ? (
          <Button onClick={onReload}>{t('reload')}</Button>
        ) : (
          <Button
            variant="outline"
            render={
              <RouteProgressLink
                href={state.status === 'missing' ? loginHref : listHref}
                prefetch={false}
              />
            }
          >
            {state.status === 'missing' ? t('signIn') : t('all')}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
