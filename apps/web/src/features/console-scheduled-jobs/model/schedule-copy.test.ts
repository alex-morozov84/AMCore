import { describe, expect, it } from 'vitest'

import { describeSchedule, durationParts } from './schedule-copy'

const cron = (expression: string, timeZone: string | null = null) =>
  ({ kind: 'cron', expression, timeZone }) as const

describe('describeSchedule', () => {
  it('reads the daily, per-minute and per-seconds shapes of the catalogue', () => {
    expect(describeSchedule(cron('0 0 2 * * *'))).toEqual({ kind: 'daily', time: '02:00' })
    // @nestjs/schedule's own constants are five-field: EVERY_DAY_AT_2AM and EVERY_MINUTE.
    expect(describeSchedule(cron('0 02 * * *'))).toEqual({ kind: 'daily', time: '02:00' })
    expect(describeSchedule(cron('*/1 * * * *'))).toEqual({ kind: 'everyMinute' })
    expect(describeSchedule(cron('0 30 13 * * *', 'UTC'))).toEqual({ kind: 'daily', time: '13:30' })
    expect(describeSchedule(cron('0 * * * * *'))).toEqual({ kind: 'everyMinute' })
    expect(describeSchedule(cron('*/30 * * * * *'))).toEqual({ kind: 'everySeconds', seconds: 30 })
    expect(describeSchedule({ kind: 'interval', everyMs: 30_000 })).toEqual({
      kind: 'everySeconds',
      seconds: 30,
    })
  })

  it('shows an expression it does not understand as written', () => {
    expect(describeSchedule(cron('0 0 2 * * 1'))).toEqual({
      kind: 'raw',
      expression: '0 0 2 * * 1',
    })
    expect(describeSchedule(cron('0 0 */2 * * *'))).toEqual({
      kind: 'raw',
      expression: '0 0 */2 * * *',
    })
    expect(describeSchedule(cron('* * *'))).toEqual({ kind: 'raw', expression: '* * *' })
  })
})

describe('durationParts', () => {
  it('uses milliseconds, then seconds with one decimal under 10 s, then minutes', () => {
    expect(durationParts(250)).toEqual({ unit: 'ms', n: 250 })
    expect(durationParts(1240)).toEqual({ unit: 'seconds', n: 1.2 })
    expect(durationParts(12_400)).toEqual({ unit: 'seconds', n: 12 })
    expect(durationParts(90_000)).toEqual({ unit: 'minutes', n: 1.5 })
  })
})
