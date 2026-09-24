import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { DateTimeRangePicker } from './date-time-range-picker'

const labels = {
  chooseDates: 'Choose dates',
  chooseEndDate: 'Choose the end date',
  rangeSeparator: ' - ',
  startTime: 'Start time',
  endTime: 'End time',
}

function Picker() {
  const [range, setRange] = useState({
    from: new Date('2026-09-09T10:00:00.016Z'),
    to: new Date('2026-09-10T12:00:00.016Z'),
  })
  return (
    <DateTimeRangePicker
      fromDate={range.from}
      toDate={range.to}
      fromTime="10:00:00"
      toTime="12:00:00"
      latestDate={new Date('2026-09-24T12:34:56Z')}
      latestTime="12:34:56"
      onDatesChange={(from, to) => setRange({ from, to })}
      onTimeChange={() => undefined}
      timeZone="UTC"
      locale="en"
      labels={labels}
    />
  )
}

async function selectDay(user: ReturnType<typeof userEvent.setup>, day: string) {
  const button = document.querySelector<HTMLButtonElement>(`[data-day="2026-09-${day}"] button`)
  expect(button).not.toBeNull()
  await user.click(button!)
}

describe('DateTimeRangePicker', () => {
  it('commits only a complete range, keeps the popup open, and resets on the next click', async () => {
    const user = userEvent.setup()
    render(<Picker />)
    await user.click(screen.getByRole('button', { name: /09\/09\/2026/ }))
    expect(screen.getByLabelText('Start time')).toHaveValue('10:00:00')
    expect(screen.getByRole('button', { name: /09\/09\/2026/ })).not.toHaveTextContent('.016')

    await selectDay(user, '12')
    expect(screen.getByText('Choose the end date')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /09\/09\/2026/ })).toBeInTheDocument()
    await selectDay(user, '15')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /09\/12\/2026.*09\/15\/2026/ })).toBeInTheDocument()
    )
    expect(screen.getByLabelText('End time')).toBeVisible()

    await selectDay(user, '18')
    expect(screen.getByText('Choose the end date')).toBeInTheDocument()
    await selectDay(user, '20')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /09\/18\/2026.*09\/20\/2026/ })).toBeInTheDocument()
    )
  })

  it('disables future calendar days and caps the time picker on today', async () => {
    const user = userEvent.setup()
    render(
      <DateTimeRangePicker
        fromDate={new Date('2026-09-23T10:00:00Z')}
        toDate={new Date('2026-09-24T12:00:00Z')}
        fromTime="10:00:00"
        toTime="12:00:00"
        latestDate={new Date('2026-09-24T12:34:56Z')}
        latestTime="12:34:56"
        onDatesChange={() => undefined}
        onTimeChange={() => undefined}
        timeZone="UTC"
        locale="en"
        labels={labels}
      />
    )
    await user.click(screen.getByRole('button', { name: /09\/23\/2026/ }))
    expect(screen.getByLabelText('End time')).toHaveAttribute('max', '12:34:56')
    expect(document.querySelector('[data-day="2026-09-25"] button')).toBeDisabled()
  })
})
