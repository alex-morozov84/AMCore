'use client'

import { useEffect, useSyncExternalStore } from 'react'

import type { AccountMfaController } from './account-mfa-controller'
import { readMfaReference, writeMfaReference } from './recovery-reference'

export function useAccountMfa(controller: AccountMfaController, inspectOnMount = true) {
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
    if (!inspectOnMount) return
    const scope = controller.getRecoveryScope()
    const reference = scope ? readMfaReference(scope) : undefined
    if (reference) controller.restoreReference(reference)
    const unsubscribe = controller.subscribe(() => {
      if (scope) writeMfaReference(scope, controller.getRecoveryReference())
    })
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
      unsubscribe()
    }
  }, [controller, inspectOnMount])
  return { ...state, secrets }
}
