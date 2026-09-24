'use client'

import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { enUS, ru } from 'react-day-picker/locale'
import { CalendarDays, Clock3 } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { Calendar } from '@/shared/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'

interface DateTimeRangePickerProps {
  fromDate?: Date
  toDate?: Date
  fromTime: string
  toTime: string
  latestDate?: Date
  latestTime?: string
  onOpenChange?: (open: boolean) => void
  onDatesChange: (from: Date, to: Date) => void
  onTimeChange: (end: 'from' | 'to', time: string) => void
  timeZone: string
  locale: string
  labels: {
    chooseDates: string
    chooseEndDate: string
    rangeSeparator: string
    startTime: string
    endTime: string
  }
  invalid?: boolean
}

export function DateTimeRangePicker({
  fromDate,
  toDate,
  fromTime,
  toTime,
  latestDate,
  latestTime,
  onOpenChange,
  onDatesChange,
  onTimeChange,
  timeZone,
  locale,
  labels,
  invalid = false,
}: DateTimeRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>()
  const selected = draft ?? { from: fromDate, to: toDate }
  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone,
  })
  const dates = [
    fromDate && `${dateFormat.format(fromDate)}, ${fromTime}`,
    toDate && `${dateFormat.format(toDate)}, ${toTime}`,
  ].filter((date): date is string => !!date)

  function selectDates(range: DateRange) {
    if (!range.from || !range.to) {
      setDraft(range)
      return
    }
    onDatesChange(range.from, range.to)
    setDraft(undefined)
  }

  return (
    <div className="space-y-3">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setDraft(undefined)
          onOpenChange?.(next)
        }}
      >
        <PopoverTrigger
          render={<Button type="button" variant="outline" className="w-full justify-start gap-2" />}
          aria-label={
            dates.length
              ? `${labels.chooseDates}: ${dates.join(labels.rangeSeparator)}`
              : labels.chooseDates
          }
        >
          <CalendarDays aria-hidden size={16} />{' '}
          {dates.length ? dates.join(labels.rangeSeparator) : labels.chooseDates}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
          className="w-auto max-w-[calc(100vw-2rem)] gap-0 p-0"
        >
          <Calendar
            mode="range"
            required
            resetOnSelect
            timeZone={timeZone}
            locale={locale === 'ru' ? ru : enUS}
            selected={selected}
            onSelect={selectDates}
            defaultMonth={fromDate}
            disabled={latestDate ? { after: latestDate } : undefined}
            numberOfMonths={2}
            captionLayout="dropdown"
            className="max-w-full p-3"
            classNames={{
              month: 'flex w-full flex-col gap-4 [&:nth-child(2)]:hidden md:[&:nth-child(2)]:flex',
            }}
          />
          <p role="status" className="min-h-7 px-3 pb-3 text-xs text-muted-foreground">
            {draft?.from && !draft.to ? labels.chooseEndDate : null}
          </p>
          <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
            {(['from', 'to'] as const).map((end) => {
              const selectedDate = end === 'from' ? fromDate : toDate
              const maxTime =
                selectedDate &&
                latestDate &&
                latestTime &&
                dateFormat.format(selectedDate) === dateFormat.format(latestDate)
                  ? latestTime
                  : undefined
              return (
                <label key={end} className="space-y-1 text-sm">
                  <span className="block font-medium">
                    {end === 'from' ? labels.startTime : labels.endTime}
                  </span>
                  <span className="flex items-center gap-2 rounded-md border border-input bg-background px-3">
                    <Clock3 aria-hidden size={16} className="text-muted-foreground" />
                    <input
                      type="time"
                      step="1"
                      value={end === 'from' ? fromTime : toTime}
                      max={maxTime}
                      onChange={(event) => onTimeChange(end, event.target.value)}
                      aria-invalid={invalid}
                      className="min-h-9 min-w-0 flex-1 bg-transparent outline-none"
                    />
                  </span>
                </label>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
