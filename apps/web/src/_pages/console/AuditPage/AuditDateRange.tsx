'use client'

import type { AuditCopy } from './audit-copy'

interface AuditDateRangeProps {
  from: string
  to: string
  setFrom: (value: string) => void
  setTo: (value: string) => void
  copy: AuditCopy
}

export function localTime(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function utcTime(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function AuditDateRange({ from, to, setFrom, setTo, copy }: AuditDateRangeProps) {
  function chooseHours(hours: number) {
    const end = new Date()
    setTo(localTime(end.toISOString()))
    setFrom(localTime(new Date(end.getTime() - hours * 60 * 60_000).toISOString()))
  }

  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">{copy.customRange}</legend>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => chooseHours(24)}
          className="rounded-md border border-border px-3 py-1 text-sm"
        >
          {copy.recentDay}
        </button>
        <button
          type="button"
          onClick={() => chooseHours(7 * 24)}
          className="rounded-md border border-border px-3 py-1 text-sm"
        >
          {copy.recentWeek}
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          {copy.from}
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="block w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          {copy.to}
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="block w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{copy.localTime}</p>
    </fieldset>
  )
}
