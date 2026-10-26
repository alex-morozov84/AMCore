'use client'

import { ChevronDownIcon } from 'lucide-react'

export function LocaleSelector({
  label,
  items,
  value,
  pending,
  onChange,
}: {
  label: string
  items: readonly { value: string; label: string }[]
  value: string
  pending: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="relative inline-flex min-w-0">
      <select
        aria-label={label}
        value={value}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 min-w-0 max-w-40 cursor-pointer appearance-none rounded-md border border-input bg-background py-0 pl-3 pr-9 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-50"
      >
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}
