'use client'

import { useId } from 'react'
import { useTranslations } from 'next-intl'

import { useConsoleTimeZone } from '@/shared/lib/console-time-zone'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

function TimeZoneOptions({ items }: { items: { value: string; label: string }[] }) {
  return (
    <SelectContent className="max-w-[calc(100vw-2rem)]">
      {items.map((item) => (
        <SelectItem key={item.value} value={item.value}>
          {item.label}
        </SelectItem>
      ))}
    </SelectContent>
  )
}

export function ConsoleTimeZoneSwitcher() {
  const t = useTranslations('console.timeZone')
  const descriptionId = useId()
  const { mode, setMode, browserZone } = useConsoleTimeZone()
  const offset = new Intl.DateTimeFormat('en', {
    timeZone: browserZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date())
    .find((part) => part.type === 'timeZoneName')!
    .value.replace('GMT', 'UTC')
  const items = [
    { value: 'utc', label: 'UTC' },
    { value: 'local', label: t('localOption', { zone: browserZone, offset }) },
  ]
  return (
    <Select
      value={mode}
      items={items}
      onValueChange={(next) => {
        if (next === 'utc' || next === 'local') setMode(next)
      }}
    >
      <SelectTrigger
        className="min-w-0 gap-2 px-2 text-xs sm:px-3 sm:text-sm"
        size="sm"
        aria-label={t('label')}
        aria-describedby={descriptionId}
        title={t('description')}
      >
        <SelectValue>{t('display', { zone: mode === 'utc' ? 'UTC' : offset })}</SelectValue>
      </SelectTrigger>
      <span id={descriptionId} className="sr-only">
        {t('description')}
      </span>
      <TimeZoneOptions items={items} />
    </Select>
  )
}
