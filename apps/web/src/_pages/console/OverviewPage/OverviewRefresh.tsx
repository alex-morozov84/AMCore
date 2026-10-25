'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { RefreshCw } from 'lucide-react'

import { useCooldownTicks } from '@/shared/lib/console-cooldown-ticks'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Button } from '@/shared/ui/button'

export function OverviewRefresh({
  retryAfterMs = 0,
  renderId = '',
}: {
  retryAfterMs?: number
  renderId?: string
}) {
  const t = useTranslations('console')
  const router = useRouteProgressRouter()
  const [pending, startTransition] = useTransition()
  const [clock, setClock] = useState<{ now: number; until: number } | null>(null)
  const seen = useRef<string | null>(null)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (seen.current === renderId) return
    seen.current = renderId
    const at = Date.now()
    setClock((current) => ({ now: at, until: Math.max(current?.until ?? 0, at + retryAfterMs) }))
    setNow(at)
  }, [renderId, retryAfterMs])
  const until = clock?.until ?? 0
  const seconds = clock
    ? Math.max(0, Math.ceil((until - now) / 1000))
    : Math.ceil(retryAfterMs / 1000)
  const floors = useMemo(() => ({ retryAfterUntil: until, backoffUntil: 0 }), [until])
  useCooldownTicks(floors, setNow)
  return (
    <div className="space-y-1 sm:text-right">
      <Button
        variant="outline"
        aria-busy={pending}
        disabled={pending || seconds > 0}
        onClick={() => startTransition(() => router.refresh())}
      >
        <RefreshCw aria-hidden="true" className="size-4" />
        {t(pending ? 'overviewRefreshing' : 'overviewRefresh')}
      </Button>
      {seconds > 0 && (
        <p className="text-xs text-muted-foreground">{t('problems.retryWait', { seconds })}</p>
      )}
    </div>
  )
}
