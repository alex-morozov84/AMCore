'use client'

import { type ReactNode, useId } from 'react'
import { useTranslations } from 'next-intl'
import type { ProductAccessBootstrap } from '@amcore/shared'
import { useQuery } from '@tanstack/react-query'

import { provisioningClient } from '@/shared/api/console/provisioning-client'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'

export function AdministrationSession({
  children,
}: {
  children: (admission: ProductAccessBootstrap) => ReactNode
}) {
  const t = useTranslations('console.organizationAdministration')
  const id = useId()
  const session = useQuery({
    queryKey: ['administration-session', id],
    queryFn: ({ signal }) => provisioningClient.session(signal),
    retry: false,
    gcTime: 0,
  })
  if (session.data) return children(session.data)
  return (
    <div className="space-y-3">
      <ApiErrorAlert error={session.error} />
      {session.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <Button variant="outline" onClick={() => void session.refetch()}>
          {t('refresh')}
        </Button>
      )}
    </div>
  )
}
