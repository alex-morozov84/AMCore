import { useMemo, useSyncExternalStore } from 'react'

import { createInvitationAcceptJournal, type InvitationAcceptDescriptor } from './accept-journal'

import 'client-only'

/** Hydration-safe tab journal projection. Only nonsecret intent is read on activation. */
export function useInvitationAcceptDescriptor(flowId?: string) {
  const store = useMemo(() => {
    let snapshot: InvitationAcceptDescriptor | null = null
    const listeners = new Set<() => void>()
    const read = () => {
      const next = flowId ? createInvitationAcceptJournal().read(flowId) : null
      if (JSON.stringify(snapshot) !== JSON.stringify(next)) {
        snapshot = next
        listeners.forEach(listener => listener())
      }
    }
    return {
      getSnapshot: () => snapshot,
      getServerSnapshot: () => null,
      subscribe(listener: () => void) {
        listeners.add(listener)
        read()
        window.addEventListener('focus', read)
        window.addEventListener('pageshow', read)
        window.addEventListener('storage', read)
        return () => {
          listeners.delete(listener)
          window.removeEventListener('focus', read)
          window.removeEventListener('pageshow', read)
          window.removeEventListener('storage', read)
        }
      },
    }
  }, [flowId])
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
}
