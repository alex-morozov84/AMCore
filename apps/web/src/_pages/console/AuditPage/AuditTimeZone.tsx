'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'

type Mode = 'utc' | 'local'

interface TimeZoneState {
  mode: Mode
  zone: string
  setMode: (mode: Mode) => void
}

const AuditTimeZoneContext = createContext<TimeZoneState | null>(null)

export function AuditTimeZoneProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('utc')
  // The server and the first client render both use UTC. Browser zone is read
  // only after the operator explicitly chooses local display.
  const zone = mode === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'
  return (
    <AuditTimeZoneContext.Provider value={{ mode, zone, setMode }}>
      {children}
    </AuditTimeZoneContext.Provider>
  )
}

export function useAuditTimeZone(): TimeZoneState {
  const value = useContext(AuditTimeZoneContext)
  if (!value) throw new Error('Audit time zone provider missing')
  return value
}

export function localUtcOffset(date = new Date()): string {
  const minutes = -date.getTimezoneOffset()
  const sign = minutes >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')
  const remainder = String(Math.abs(minutes) % 60).padStart(2, '0')
  return `UTC${sign}${hours}:${remainder}`
}

export function formatInputInstant(value: string, mode: Mode): string {
  const date = new Date(value)
  const shifted =
    mode === 'utc' ? date : new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  const formatted = shifted.toISOString().slice(0, 23)
  return formatted.endsWith('.000') ? formatted.slice(0, 19) : formatted
}

export function parseInputInstant(value: string, mode: Mode): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) return null
  const date = new Date(mode === 'utc' ? `${value}Z` : value)
  if (
    !Number.isFinite(date.getTime()) ||
    !formatInputInstant(date.toISOString(), mode).startsWith(value)
  )
    return null
  if (mode === 'local') {
    for (let minutes = -120; minutes <= 120; minutes += 15) {
      if (minutes === 0) continue
      const other = new Date(date.getTime() + minutes * 60_000)
      if (formatInputInstant(other.toISOString(), mode).startsWith(value)) return null
    }
  }
  return date.toISOString()
}
