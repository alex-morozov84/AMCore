'use client'

import { useTranslations } from 'next-intl'
import type { AdminOverviewDependency } from '@amcore/shared'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'

interface OverviewNotReadyAlertProps {
  dependencies: AdminOverviewDependency[]
}

/**
 * Scoped "this API instance is not ready" state — observed data, HTTP 200.
 * Distinct from `PrimaryUnavailableFallback`'s "the observation itself
 * could not be fetched" state (a real transport failure to the Overview
 * endpoint). Never says the console is unhealthy: the console is the
 * observer here, not the observed instance.
 */
export function OverviewNotReadyAlert({ dependencies }: OverviewNotReadyAlertProps) {
  const t = useTranslations('console')
  const router = useRouteProgressRouter()
  const failing = dependencies.filter((dependency) => dependency.status !== 'up')

  return (
    <Alert variant="destructive">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>{t('overviewNotReadyTitle')}</AlertTitle>
      <AlertDescription className="gap-3">
        {failing.length > 0 && (
          <span>
            {t('overviewNotReadyDependencies', {
              dependencies: failing.map((dependency) => dependency.name).join(', '),
            })}
          </span>
        )}
        <Button size="sm" onClick={() => router.refresh()}>
          <RefreshCw className="size-4" />
          {t('overviewRefresh')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
