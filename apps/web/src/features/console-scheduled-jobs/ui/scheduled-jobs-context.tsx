'use client'

import { createContext, useContext } from 'react'

/**
 * What every part of the live page shares: the id that scopes its private query cache, and the one
 * way to report a lost session. A history that is refused calls `onAccessLoss`, so the page owner
 * hides everything and asks the Console frame to re-admit once; no part decides this alone.
 */
export interface ScheduledJobsScope {
  instance: string
  onAccessLoss: () => void
}

const ScopeContext = createContext<ScheduledJobsScope | null>(null)

export const ScheduledJobsScopeProvider = ScopeContext.Provider

export function useScheduledJobsScope(): ScheduledJobsScope {
  const scope = useContext(ScopeContext)
  if (!scope) throw new Error('ScheduledJobsScopeProvider is missing')
  return scope
}
