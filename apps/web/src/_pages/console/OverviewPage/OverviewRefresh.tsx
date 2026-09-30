'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { RefreshCw } from 'lucide-react'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Button } from '@/shared/ui/button'

export function OverviewRefresh() {
  const t = useTranslations('console')
  const router = useRouteProgressRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="outline"
      aria-busy={pending}
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw aria-hidden="true" className="size-4" />
      {t(pending ? 'overviewRefreshing' : 'overviewRefresh')}
    </Button>
  )
}
