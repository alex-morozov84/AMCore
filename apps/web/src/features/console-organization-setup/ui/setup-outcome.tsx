'use client'

import { useTranslations } from 'next-intl'
import type { OrganizationSetupAccount, OrganizationSetupStatus } from '@amcore/shared'

import {
  getConsoleOrganizationDetailHref,
  getConsoleUserDetailHref,
} from '@/shared/lib/console-public-href'
import { buttonVariants } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

export function SetupOutcome({
  installation,
  account,
}: {
  installation: OrganizationSetupStatus
  account?: OrganizationSetupAccount
}) {
  const t = useTranslations('console.organizationSetup')
  const completed =
    installation.state === 'completed-intact' || installation.state === 'completed-changed'
  if (!completed)
    return (
      <div className="max-w-2xl space-y-3">
        <p role="status" className="font-medium">
          {t(`states.${installation.state}`)}
        </p>
        <p>
          {t(
            installation.state === 'existing-org-without-receipt'
              ? 'existingOrganizationHelp'
              : 'deploymentHelp'
          )}
        </p>
        {installation.reason && <p>{t(`reasons.${installation.reason}`)}</p>}
      </div>
    )
  return (
    <div className="max-w-2xl space-y-4">
      <h3 className="text-lg font-semibold">{t(`states.${installation.state}`)}</h3>
      {account && (
        <p className="break-words">{t('completedAdministrator', { email: account.email })}</p>
      )}
      <p role="status">
        {t(installation.state === 'completed-intact' ? 'nextSteps' : 'changedHelp')}
      </p>
      {installation.ids && (
        <div className="flex flex-wrap gap-2">
          <RouteProgressLink
            className={buttonVariants({ variant: 'default' })}
            href={getConsoleOrganizationDetailHref(installation.ids.organizationId)}
          >
            {t('openOrganization')}
          </RouteProgressLink>
          {installation.state === 'completed-changed' && (
            <RouteProgressLink
              className={buttonVariants({ variant: 'outline' })}
              href={getConsoleUserDetailHref(installation.ids.userId)}
            >
              {t('openAdministrator')}
            </RouteProgressLink>
          )}
        </div>
      )}
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">{t('completedDetails')}</summary>
        <p className="mt-2">{t('completedHelp')}</p>
        {installation.ids && (
          <p className="mt-2 break-all">
            {t('completed', { organizationId: installation.ids.organizationId })}
          </p>
        )}
      </details>
    </div>
  )
}
