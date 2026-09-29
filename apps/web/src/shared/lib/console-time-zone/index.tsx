'use client'

import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react'

import type { ConsoleTimeZoneMode } from './preference'
import {
  readConsoleBrowserTimeZone,
  readConsoleTimeZone,
  subscribeConsoleTimeZone,
  writeConsoleTimeZone,
} from './preference'

const Context = createContext(false)
const serverSnapshot = (): ConsoleTimeZoneMode => 'utc'
const serverZone = () => 'UTC'
const noSubscription = () => () => {}

export function ConsoleTimeZoneProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={true}>{children}</Context.Provider>
}

/** Each streamed consumer hydrates against UTC before reading saved browser state. */
export function useConsoleTimeZone() {
  const enabled = useContext(Context)
  const subscribe = enabled ? subscribeConsoleTimeZone : noSubscription
  const mode = useSyncExternalStore(
    subscribe,
    enabled ? readConsoleTimeZone : serverSnapshot,
    serverSnapshot
  )
  const browserZone = useSyncExternalStore(
    subscribe,
    enabled ? readConsoleBrowserTimeZone : serverZone,
    serverZone
  )
  const zone = mode === 'local' ? browserZone : 'UTC'
  return { mode, zone, browserZone, setMode: writeConsoleTimeZone }
}
