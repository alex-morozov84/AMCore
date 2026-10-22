import { type INestApplication, Injectable } from '@nestjs/common'
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule'
import { Test } from '@nestjs/testing'

import { ScheduledJob, type ScheduledJobDefinition } from './scheduled-job.js'

/**
 * The decorator against the real scheduler: the job keeps its tick times and its overlap behaviour,
 * is readable by name from the registry once mounted, and its next planned fire can be read at the
 * moment a run starts (the value recorded as "next fire after this run").
 */
const everySecond: ScheduledJobDefinition = {
  id: 'runtime-cron',
  family: 'per-replica',
  schedule: { kind: 'cron', expression: '* * * * * *', timeZone: null },
  graceMs: 5000,
}
const everyTick: ScheduledJobDefinition = {
  id: 'runtime-interval',
  family: 'per-replica',
  schedule: { kind: 'interval', everyMs: 200 },
  graceMs: 5000,
  staleAfterMs: 5000,
}

const seen = {
  cronStarts: [] as number[],
  nextAtStart: [] as (Date | null)[],
  running: 0,
  maxRunning: 0,
  intervalStarts: [] as number[],
}

@Injectable()
class Probe {
  constructor(private readonly registry: SchedulerRegistry) {}

  @ScheduledJob(everySecond)
  async slowCron(): Promise<void> {
    seen.cronStarts.push(Date.now())
    seen.nextAtStart.push(this.registry.getCronJob(everySecond.id).nextDate().toJSDate())
    seen.running += 1
    seen.maxRunning = Math.max(seen.maxRunning, seen.running)
    // Longer than the tick period: the standard scheduler lets the next tick start meanwhile.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    seen.running -= 1
  }

  @ScheduledJob(everyTick)
  tick(): void {
    seen.intervalStarts.push(Date.now())
  }
}

describe('ScheduledJob on the real scheduler', () => {
  let app: INestApplication
  let registry: SchedulerRegistry

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [Probe],
    }).compile()
    app = module.createNestApplication()
    await app.init()
    registry = app.get(SchedulerRegistry)
    await new Promise((resolve) => setTimeout(resolve, 3600))
  }, 10_000)

  afterAll(async () => {
    await app.close()
    // The last slow run is still sleeping: let it end so no timer outlives the test.
    await new Promise((resolve) => setTimeout(resolve, 1600))
  })

  it('is mounted under its id as soon as the application has started', () => {
    expect(registry.doesExist('cron', everySecond.id)).toBe(true)
    expect(registry.doesExist('interval', everyTick.id)).toBe(true)
  })

  it('fires on the schedule it declares, one tick per period', () => {
    expect(seen.cronStarts.length).toBeGreaterThanOrEqual(2)
    expect(seen.cronStarts.length).toBeLessThanOrEqual(4)
    for (let i = 1; i < seen.cronStarts.length; i += 1)
      expect((seen.cronStarts[i] as number) - (seen.cronStarts[i - 1] as number)).toBeGreaterThan(
        800
      )
    expect(seen.intervalStarts.length).toBeGreaterThanOrEqual(10)
  })

  it('does not add waiting: a run longer than the period overlaps the next tick as before', () => {
    expect(seen.maxRunning).toBeGreaterThanOrEqual(2)
  })

  it('lets a run read the next planned fire at the moment it starts, always after that start', () => {
    expect(seen.nextAtStart.length).toBeGreaterThan(0)
    seen.nextAtStart.forEach((next, index) => {
      expect(next).toBeInstanceOf(Date)
      expect((next as Date).getTime()).toBeGreaterThan(seen.cronStarts[index] as number)
    })
  })
})
