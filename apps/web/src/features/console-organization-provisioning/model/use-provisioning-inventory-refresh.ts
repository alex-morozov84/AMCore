'use client'

import { useEffect, useRef } from 'react'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

/** Refresh the server inventory once after a committed result is recovered or created. */
export function useProvisioningInventoryRefresh(orgId?: string, detail = false) {
  const { refresh } = useRouteProgressRouter()
  const seen = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!detail && orgId && seen.current !== orgId) {
      seen.current = orgId
      refresh()
    }
  }, [orgId, detail, refresh])
}
