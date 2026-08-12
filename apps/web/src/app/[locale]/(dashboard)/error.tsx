'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/shared/ui/empty'

/**
 * Catches whatever `(dashboard)/page.tsx`'s `requireSession()` rethrows
 * when auth couldn't be *proven* (Redis unreachable, lock contention, a
 * transient upstream refresh failure) — deliberately distinct from "logged
 * out," which redirects to `/login` instead of ever reaching here. See
 * `dal.ts`.
 */
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const tCommon = useTranslations('common')
  const tDashboard = useTranslations('dashboard')

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertTriangle />
        </EmptyMedia>
        <EmptyTitle>{tCommon('error')}</EmptyTitle>
        <EmptyDescription>{tDashboard('unavailable')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => retry()}>
          <RefreshCw className="size-4" />
          {tCommon('retry')}
        </Button>
      </EmptyContent>
    </Empty>
  )
}
