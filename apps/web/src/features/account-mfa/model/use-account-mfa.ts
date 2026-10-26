'use client'

import { useEffect, useSyncExternalStore } from 'react'

import type { AccountMfaController } from './account-mfa-controller'

export function useAccountMfa(controller: AccountMfaController) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )
  const secrets = useSyncExternalStore(
    controller.subscribe,
    controller.getSecrets,
    controller.getSecrets
  )
  useEffect(() => {
    void controller.inspect()
    const conceal = () => controller.conceal()
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) void controller.inspect()
    }
    window.addEventListener('pagehide', conceal)
    window.addEventListener('pageshow', restore)
    return () => {
      window.removeEventListener('pagehide', conceal)
      window.removeEventListener('pageshow', restore)
      controller.conceal()
    }
  }, [controller])
  return { ...state, secrets }
}
