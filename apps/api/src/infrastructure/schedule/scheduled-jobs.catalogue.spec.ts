import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { cadenceOf, configVersionOf, type ScheduledJobDefinition } from './scheduled-job'
import * as catalogue from './scheduled-jobs.catalogue'
import { SCHEDULED_JOBS, validateScheduledJobs } from './scheduled-jobs.catalogue'

const SRC = join(__dirname, '..', '..')
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sources(path)
    return /\.ts$/.test(name) && !/\.spec\.ts$|\.test-support\.ts$/.test(name) ? [path] : []
  })
}

describe('catalogue', () => {
  it('is valid: unique slugs, a lock exactly for singleton jobs, grace not shorter than the lock TTL', () => {
    expect(() => validateScheduledJobs(SCHEDULED_JOBS)).not.toThrow()
    const ids = SCHEDULED_JOBS.map((job) => job.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('rejects a broken definition', () => {
    const job = SCHEDULED_JOBS[0] as ScheduledJobDefinition
    expect(() => validateScheduledJobs([job, job])).toThrow(/Duplicate/)
    expect(() => validateScheduledJobs([{ ...job, id: 'Bad Id' }])).toThrow(/Invalid job id/)
    expect(() => validateScheduledJobs([{ ...job, lock: undefined }])).toThrow(/needs a lock/)
    expect(() => validateScheduledJobs([{ ...job, family: 'per-replica' }])).toThrow(
      /must not hold a lock/
    )
    expect(() => validateScheduledJobs([{ ...job, graceMs: 1 }])).toThrow(
      /shorter than the lock TTL/
    )
  })

  it('follows the freshness formulas: daily grace is at least the lock TTL, frequent is max(10 x period, 5 min)', () => {
    const daily = SCHEDULED_JOBS.filter((job) => cadenceOf(job) === 'daily')
    const frequent = SCHEDULED_JOBS.filter((job) => cadenceOf(job) === 'frequent')
    expect(daily.every((job) => job.graceMs >= (job.lock?.ttlMs ?? 0))).toBe(true)
    expect(frequent.every((job) => (job.staleAfterMs ?? 0) >= 5 * 60_000)).toBe(true)
    expect(daily.length + frequent.length).toBe(SCHEDULED_JOBS.length)
    const byId = Object.fromEntries(SCHEDULED_JOBS.map((job) => [job.id, job]))
    expect(byId['notification-recovery']?.staleAfterMs).toBe(300_000)
    expect(byId['ai-approval-expiry']?.staleAfterMs).toBe(600_000)
  })

  it('changes the config version whenever the schedule or the policy changes', () => {
    const job = SCHEDULED_JOBS[0] as ScheduledJobDefinition
    expect(configVersionOf(job)).toBe(configVersionOf({ ...job }))
    expect(configVersionOf(job)).not.toBe(
      configVersionOf({
        ...job,
        schedule: { kind: 'cron', expression: '0 0 4 * * *', timeZone: null },
      })
    )
    expect(configVersionOf(job)).not.toBe(configVersionOf({ ...job, graceMs: job.graceMs + 1 }))
  })

  it('a frequent job can name why a configuration disables it: the Telegram check needs a token', () => {
    const job = catalogue.TELEGRAM_REACHABILITY_JOB
    expect(cadenceOf(job)).toBe('frequent')
    expect(job.family).toBe('per-replica')
    const env = (token: string) =>
      ({ get: () => token }) as unknown as Parameters<
        NonNullable<ScheduledJobDefinition['disabledReason']>
      >[0]
    expect(job.disabledReason?.(env(''))).toBe('telegram_not_configured')
    expect(job.disabledReason?.(env('123:abc'))).toBeNull()
  })
})

/**
 * A fast source scan for the obvious mistakes (a raw decorator, a definition used twice). It reads
 * text, so an alias or an odd spacing can slip past it; the authoritative proof is the process-role
 * e2e, which runs Nest's own scheduler explorer on the real worker/all/web graphs and compares what
 * it registers with the catalogue (`test/process-role.e2e-spec.ts`).
 */
describe('registration guard (source scan)', () => {
  const files = sources(SRC).filter((file) => !file.endsWith('scheduled-job.ts'))

  it('finds no raw @Cron or @Interval outside the ScheduledJob decorator', () => {
    const offenders = files
      .filter((file) => /@(Cron|Interval)\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
    expect(offenders).toEqual([])
  })

  it('uses every catalogue entry on exactly one method, and no unknown definition', () => {
    const used = new Map<string, number>()
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(/@ScheduledJob\((\w+)\)/g))
        used.set(match[1] as string, (used.get(match[1] as string) ?? 0) + 1)
    }
    const exported = exportedJobs()
    expect([...used.keys()].sort()).toEqual(exported.map(([name]) => name).sort())
    for (const count of used.values()) expect(count).toBe(1)
  })
})

/** The `*_JOB` definitions the catalogue module exports, by export name. */
function exportedJobs(): [string, ScheduledJobDefinition][] {
  return Object.entries(catalogue).filter(
    (entry): entry is [string, ScheduledJobDefinition] =>
      /_JOB$/.test(entry[0]) && SCHEDULED_JOBS.includes(entry[1] as ScheduledJobDefinition)
  )
}
