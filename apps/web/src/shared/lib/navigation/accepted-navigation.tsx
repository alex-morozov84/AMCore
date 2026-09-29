'use client'

import { createContext, type ReactNode, useContext } from 'react'

const AcceptedNavigationContext = createContext<(() => void) | undefined>(undefined)

/** Shell-owned consequence, invoked only after the navigating caller has accepted. */
export function AcceptedNavigationProvider({
  onAccepted,
  children,
}: {
  onAccepted: () => void
  children: ReactNode
}) {
  return <AcceptedNavigationContext value={onAccepted}>{children}</AcceptedNavigationContext>
}

export const useAcceptedNavigation = () => useContext(AcceptedNavigationContext)
