'use client'

import { useId } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'

import { establishmentConsoleClient } from '@/shared/api/console/establishment-client'
import { getRetryAfterMs } from '@/shared/api/errors'
import { useRetryDeadline } from '@/shared/hooks/use-retry-deadline'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'

import { BoundSetup } from './bound-setup'

const canRefreshSession = (query: { state: { error: unknown; errorUpdatedAt: number } }) =>
  Date.now() >= query.state.errorUpdatedAt + (getRetryAfterMs(query.state.error) ?? 0)

/** Read state before offering initial-only controls; ordinary provisioning remains separate. */
export function OrganizationSetup() {
  const t = useTranslations('console.organizationSetup')
  const instance = useId()
  const session = useQuery({
    queryKey: ['initial-setup-session', instance],
    queryFn: ({ signal }) => establishmentConsoleClient.session(signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: canRefreshSession,
    refetchOnReconnect: canRefreshSession,
  })
  const sessionThrottled = useRetryDeadline(
    session.error ? session.errorUpdatedAt + (getRetryAfterMs(session.error) ?? 0) : undefined
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {session.isFetching ? (
          <p role="status">{t('loading')}</p>
        ) : session.isError ? (
          <>
            <ApiErrorAlert error={session.error} />
            <Button
              variant="outline"
              disabled={sessionThrottled}
              onClick={() => {
                void session.refetch()
              }}
            >
              {t('refresh')}
            </Button>
          </>
        ) : session.data ? (
          <BoundSetup
            key={`${session.data.binding}:${session.data.actor.id}`}
            admission={session.data}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}
