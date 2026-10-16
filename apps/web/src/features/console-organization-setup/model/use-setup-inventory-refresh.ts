'use client'

import { useEffect, useRef } from 'react'
import type { OrganizationSetupState } from '@amcore/shared'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

/** Refresh the server-rendered inventory after completion, without discarding the recovery form. */
export function useSetupInventoryRefresh(state?: OrganizationSetupState) {
  const { refresh } = useRouteProgressRouter()
  const wasEligible = useRef(false)
  useEffect(() => {
    if (state === 'eligible-empty') wasEligible.current = true
    if (wasEligible.current && (state === 'completed-intact' || state === 'completed-changed')) {
      wasEligible.current = false
      refresh()
    }
  }, [state, refresh])
}
