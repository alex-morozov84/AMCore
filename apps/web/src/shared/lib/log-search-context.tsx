'use client'

import { createContext, type ReactNode, useContext } from 'react'

import type { LogSearchTarget } from './log-search-link'

const LogSearchTargetContext = createContext<LogSearchTarget | null>(null)

/**
 * Hands the configured log-search target (or `null`) from the server, where the setting is read, to
 * every Console client component, so none of them is passed it through props. The target is plain data:
 * a kind and an already validated address.
 */
export function LogSearchTargetProvider({
  target,
  children,
}: {
  target: LogSearchTarget | null
  children: ReactNode
}) {
  return <LogSearchTargetContext value={target}>{children}</LogSearchTargetContext>
}

export function useLogSearchTarget(): LogSearchTarget | null {
  return useContext(LogSearchTargetContext)
}
