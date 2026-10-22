import { randomUUID } from 'node:crypto'

import { PrismaPg } from '@prisma/adapter-pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'

import { PrismaClient } from '../src/generated/prisma/client'
import {
  type Anchor,
  type Evidence,
  PendingEvidence,
  type RunClock,
  type Snapshot,
} from '../src/infrastructure/schedule/scheduled-job-pending'
import { register } from '../src/infrastructure/schedule/scheduled-job-registration.sql'
import { RUN_CAPS } from '../src/infrastructure/schedule/scheduled-job-runs.sql'
import { writeSnapshot } from '../src/infrastructure/schedule/scheduled-job-writer'
import type { PrismaService } from '../src/prisma'

import { e2eContainerLabels } from './e2e-owned-containers'
import { migrateTestDatabase } from './helpers'

/**
 * The write path of scheduled-job evidence against a real Postgres: atomic whole-snapshot merge by
 * `(startedAt, runId)`, the hard caps of the run table under concurrency, and registration rules.
 */
describe('Scheduled job evidence (PostgreSQL)', () => {
  let container: StartedPostgreSqlContainer
  let db: PrismaClient
  let service: PrismaService
  let mono = 1000
  // One anchor for the whole process, as the recorder keeps; every event of a run shares its clock.
  let anchor: Anchor | null = null
  const anchors = { adopt: (sample: Anchor): Anchor => (anchor ??= sample) }
  const clocks = new Map<string, RunClock>()
  const clockOf = (runId: string): RunClock => {
    const known = clocks.get(runId)
    if (known) return known
    const made: RunClock = { anchor: null }
    clocks.set(runId, made)
    return made
  }
  const startMonos = new Map<string, number>()

  const catalogue = ['cleanup', 'invitation-retention', 'notification-recovery']
  const evidence = (over: Partial<Evidence> = {}): Evidence => {
    const runId = over.runId ?? randomUUID()
    return {
      kind: 'success',
      jobId: 'cleanup',
      cadence: 'daily',
      runId,
      clock: clockOf(runId),
      startMono: (mono += 10),
      endMono: mono + 5,
      durationMs: 5,
      code: null,
      summary: null,
      skipReason: null,
      dueAt: new Date('2030-01-01T02:00:00.000Z'),
      configVersion: 'v1',
      nextFireAt: new Date('2030-01-01T02:00:00.000Z'),
      ...over,
    }
  }
  const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
    lane: 'event',
    evidence: [],
    starts: [],
    finishes: [],
    dropped: new Map(),
    ...over,
  })
  const write = (over: Partial<Snapshot>): Promise<void> =>
    writeSnapshot(service, snapshot(over), catalogue, anchors)

  const summary = (jobId: string) => db.scheduledJobSummary.findUniqueOrThrow({ where: { jobId } })
  const counts = async (jobId: string) => {
    const rows = await db.scheduledJobRun.findMany({ where: { jobId } })
    return {
      open: rows.filter((row) => row.outcome === null).length,
      abandoned: rows.filter((row) => row.outcome === 'unknown').length,
      terminal: rows.filter((row) => row.outcome !== null && row.outcome !== 'unknown').length,
      total: rows.length,
    }
  }
  async function registerAll(configVersion = 'v1'): Promise<void> {
    await db.$transaction((tx) =>
      register(
        tx,
        catalogue.map((jobId) => ({
          jobId,
          configVersion,
          scheduleTimeZone: 'UTC',
          disabledReason: null,
          nextFireAt: new Date('2030-01-01T02:00:00.000Z'),
        })),
        new Date().toISOString()
      )
    )
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .start()
    await migrateTestDatabase(container.getConnectionUri())
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: container.getConnectionUri(), max: 12 }),
    })
    await db.$connect()
    service = db as unknown as PrismaService
  }, 120000)
  afterAll(async () => {
    await db?.$disconnect()
    await container?.stop()
  }, 60000)
  beforeEach(async () => {
    await db.scheduledJobRun.deleteMany()
    await db.scheduledJobSummary.deleteMany()
    await registerAll()
  })

  describe('snapshot merge', () => {
    it('accepts the first outcome of each kind on an empty snapshot', async () => {
      await write({
        evidence: [
          evidence({ kind: 'success' }),
          evidence({ kind: 'partial', code: 'bucket_failed' }),
          evidence({ kind: 'failure', code: 'x' }),
          evidence({ kind: 'skip', skipReason: 'lock_unavailable' }),
        ],
      })
      const row = await summary('cleanup')
      expect(row.successRunId).not.toBeNull()
      expect(row.partialCode).toBe('bucket_failed')
      expect(row.failureCode).toBe('x')
      expect(row.skipReason).toBe('lock_unavailable')
      expect(row.successDueAt).not.toBeNull()
      expect(row.successConfigVersion).toBe('v1')
    })

    it('replaces the whole snapshot with a newer event and ignores an older or duplicate one', async () => {
      const middle = evidence({
        kind: 'failure',
        code: 'middle',
        summary: { counts: { a: 1 }, codes: ['m'] },
        startMono: 5000,
      })
      await write({ evidence: [middle] })
      await write({ evidence: [evidence({ kind: 'failure', code: 'older', startMono: 4000 })] })
      await write({ evidence: [middle] })
      expect((await summary('cleanup')).failureCode).toBe('middle')

      await write({
        evidence: [
          evidence({
            kind: 'failure',
            code: 'newer',
            summary: { counts: { b: 2 }, codes: ['n'] },
            durationMs: 77,
            startMono: 6000,
          }),
        ],
      })
      const row = await summary('cleanup')
      // Code, summary and duration all belong to the same, newer run: no field of the old one remains.
      expect(row.failureCode).toBe('newer')
      expect(row.failureSummary).toEqual({ counts: { b: 2 }, codes: ['n'] })
      expect(row.failureDurationMs).toBe(77)
    })

    it('breaks a tie of start times by run id, deterministically', async () => {
      const low = '00000000-0000-4000-8000-000000000001'
      const high = '00000000-0000-4000-8000-000000000002'
      await write({
        evidence: [evidence({ kind: 'failure', code: 'high', runId: high, startMono: 9000 })],
      })
      await write({
        evidence: [evidence({ kind: 'failure', code: 'low', runId: low, startMono: 9000 })],
      })
      expect((await summary('cleanup')).failureCode).toBe('high')
    })

    it('never lets a late failure of one replica displace a newer success of another', async () => {
      await write({ evidence: [evidence({ kind: 'success', startMono: 8000 })] })
      await write({ evidence: [evidence({ kind: 'failure', code: 'late', startMono: 7000 })] })
      const row = await summary('cleanup')
      expect(row.successRunId).not.toBeNull()
      expect(row.failureCode).toBe('late') // kept as its own kind; the result axis picks the newest by key
    })

    it('rejects a snapshot whose key pair is half-written (CHECK)', async () => {
      await expect(
        db.$executeRaw`UPDATE core.scheduled_job_summaries SET "successStartedAt" = now() WHERE "jobId" = 'cleanup'`
      ).rejects.toThrow()
      await expect(
        db.$executeRaw`UPDATE core.scheduled_job_summaries SET "partialCode" = 'x' WHERE "jobId" = 'cleanup'`
      ).rejects.toThrow()
    })

    it('counts lost observations and refreshes the display fields', async () => {
      await write({
        evidence: [evidence({ nextFireAt: new Date('2031-05-05T02:00:00.000Z') })],
        dropped: new Map([['cleanup', 3]]),
      })
      const row = await summary('cleanup')
      expect(row.droppedEvents).toBe(3)
      expect(row.nextFireAt?.toISOString()).toBe('2031-05-05T02:00:00.000Z')
    })
  })

  describe('run history caps', () => {
    const start = (runId = randomUUID()) => {
      const startMono = (mono += 10)
      startMonos.set(runId, startMono)
      return {
        jobId: 'cleanup',
        runId,
        startMono,
        maxRuntimeMs: 30 * 60_000,
        clock: clockOf(runId),
      }
    }
    const finish = (runId: string, outcome: 'success' | 'failed' = 'success') => ({
      jobId: 'cleanup',
      runId,
      outcome,
      startMono: startMonos.get(runId) ?? 0,
      endMono: (mono += 10),
      durationMs: 5,
      code: null,
      summary: null,
      clock: clockOf(runId),
    })

    it('tracks a run from start to finish and closes only its own row', async () => {
      const a = start()
      const b = start()
      await write({ starts: [a, b] })
      await write({ finishes: [finish(a.runId)] })
      const rows = await db.scheduledJobRun.findMany({ where: { jobId: 'cleanup' } })
      expect(rows.find((row) => row.runId === a.runId)?.outcome).toBe('success')
      expect(rows.find((row) => row.runId === a.runId)?.finishedAt).not.toBeNull()
      expect(rows.find((row) => row.runId === b.runId)?.outcome).toBeNull()
    })

    it('never admits more than three open runs, however many start at once', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () => write({ starts: [start()] }))
      )
      expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
      const { open } = await counts('cleanup')
      expect(open).toBe(RUN_CAPS.open)
      expect((await summary('cleanup')).droppedEvents).toBe(9)
    })

    it('keeps terminal history at 30 after finishes, so a finish cannot lift a cap', async () => {
      for (let index = 0; index < RUN_CAPS.terminal + 6; index += 1) {
        const run = start()
        await write({ starts: [run] })
        await write({ finishes: [finish(run.runId)] })
      }
      const { terminal, open, total } = await counts('cleanup')
      expect(terminal).toBe(RUN_CAPS.terminal)
      expect(open).toBe(0)
      expect(total).toBeLessThanOrEqual(40)
    })

    it('turns stale open runs into abandoned ones (never a success) and keeps at most seven', async () => {
      for (let index = 0; index < 12; index += 1) {
        await db.scheduledJobRun.create({
          data: {
            runId: randomUUID(),
            jobId: 'cleanup',
            startedAt: new Date(Date.now() - (3 + index) * 3_600_000),
          },
        })
      }
      await write({ starts: [start()] })
      const { abandoned, open } = await counts('cleanup')
      expect(abandoned).toBeLessThanOrEqual(RUN_CAPS.abandoned)
      expect(open).toBe(1)
      const rows = await db.scheduledJobRun.findMany({ where: { outcome: 'unknown' } })
      expect(rows.every((row) => row.finishedAt === null)).toBe(true)
    })

    it('closes an abandoned run that did finish after all, within the caps', async () => {
      const slow = randomUUID()
      await db.scheduledJobRun.create({
        data: {
          runId: slow,
          jobId: 'cleanup',
          startedAt: new Date(Date.now() - 5 * 3_600_000),
          outcome: 'unknown',
        },
      })
      await write({ finishes: [finish(slow, 'failed')] })
      const row = await db.scheduledJobRun.findUniqueOrThrow({ where: { runId: slow } })
      expect(row.outcome).toBe('failed')
      expect(row.finishedAt).not.toBeNull()
    })

    it('closes only the abandoned run when its late finish comes after the next run began', async () => {
      const pending = new PendingEvidence()
      const first = randomUUID()
      const second = randomUUID()
      const maxRuntimeMs = 1000
      const begin = (runId: string, startMono: number): void => {
        startMonos.set(runId, startMono)
        pending.startRun({
          jobId: 'cleanup',
          runId,
          startMono,
          maxRuntimeMs,
          clock: clockOf(runId),
        })
      }
      begin(first, (mono += 10))
      await writeSnapshot(service, pending.take('event'), catalogue, anchors)
      // The next run begins after the first outlived its maximum runtime: its slot is released
      // and the database marks the first row abandoned.
      // The database clock decides what is abandoned, so let real time pass as well.
      await new Promise((resolve) => setTimeout(resolve, maxRuntimeMs + 700))
      mono += maxRuntimeMs + 700
      begin(second, mono)
      await writeSnapshot(service, pending.take('event'), catalogue, anchors)
      expect(
        (await db.scheduledJobRun.findUniqueOrThrow({ where: { runId: first } })).outcome
      ).toBe('unknown')
      // The first run finally ends with a known outcome, through the same pending state.
      expect(pending.finishRun({ ...finish(first), startMono: startMonos.get(first) ?? 0 })).toBe(
        true
      )
      await writeSnapshot(service, pending.take('event'), catalogue, anchors)
      expect(
        (await db.scheduledJobRun.findUniqueOrThrow({ where: { runId: first } })).outcome
      ).toBe('success')
      expect(
        (await db.scheduledJobRun.findUniqueOrThrow({ where: { runId: second } })).outcome
      ).toBeNull()
    })

    it('counts a finish that has no run row as a lost observation and still writes the summary', async () => {
      const runId = randomUUID()
      await write({ finishes: [finish(runId)], evidence: [evidence({ runId })] })
      expect((await summary('cleanup')).droppedEvents).toBe(1)
      expect((await summary('cleanup')).successRunId).toBe(runId)
      expect(await db.scheduledJobRun.count({ where: { runId } })).toBe(0)
    })

    it('changes only the row of the finished run even when several are abandoned', async () => {
      const target = randomUUID()
      const other = randomUUID()
      for (const runId of [target, other])
        await db.scheduledJobRun.create({
          data: {
            runId,
            jobId: 'cleanup',
            startedAt: new Date(Date.now() - 4 * 3_600_000),
            outcome: 'unknown',
          },
        })
      await write({ finishes: [finish(target)] })
      expect(
        (await db.scheduledJobRun.findUniqueOrThrow({ where: { runId: other } })).outcome
      ).toBe('unknown')
    })

    it('holds the table cap: a full table evicts only unknown jobs, then refuses', async () => {
      await db.$executeRaw`
        INSERT INTO core.scheduled_job_runs ("runId", "jobId", "startedAt", "finishedAt", outcome)
        SELECT gen_random_uuid(), 'removed-' || (g % 64), now() - make_interval(secs => g), now(), 'success'
        FROM generate_series(1, ${RUN_CAPS.rows}) g`
      const total = async () => await db.scheduledJobRun.count()
      expect(await total()).toBe(RUN_CAPS.rows)
      await write({ starts: [start()] })
      // 100 rows of removed jobs were evicted to make room; the run was admitted.
      expect(await total()).toBe(RUN_CAPS.rows - 100 + 1)
      expect((await counts('cleanup')).open).toBe(1)

      // Now fill the table with rows of KNOWN jobs only: nothing may be evicted and the run is refused.
      await db.scheduledJobRun.deleteMany()
      await db.$executeRaw`
        INSERT INTO core.scheduled_job_runs ("runId", "jobId", "startedAt", "finishedAt", outcome)
        SELECT gen_random_uuid(), 'invitation-retention', now() - make_interval(secs => g), now(), 'success'
        FROM generate_series(1, ${RUN_CAPS.rows}) g`
      await write({ starts: [start()] })
      expect(await total()).toBe(RUN_CAPS.rows)
      expect((await counts('cleanup')).open).toBe(0)
      expect((await summary('cleanup')).droppedEvents).toBeGreaterThanOrEqual(1)
    }, 60000)
  })

  describe('registration', () => {
    it('keeps the first registration and the baseline across restarts', async () => {
      const before = await summary('cleanup')
      await new Promise((resolve) => setTimeout(resolve, 20))
      await registerAll()
      const after = await summary('cleanup')
      expect(after.firstRegisteredAt.getTime()).toBe(before.firstRegisteredAt.getTime())
      expect(after.lastRegisteredAt.getTime()).toBeGreaterThan(before.lastRegisteredAt.getTime())
      expect(after.baselineDueAt?.getTime()).toBe(before.baselineDueAt?.getTime())
    })

    it('restarts the baseline when the config version changes, and keeps recorded evidence', async () => {
      await write({ evidence: [evidence({ kind: 'success' })] })
      await db.scheduledJobSummary.update({
        where: { jobId: 'cleanup' },
        data: { baselineDueAt: new Date('2000-01-01T00:00:00.000Z') },
      })
      await registerAll('v2')
      const row = await summary('cleanup')
      expect(row.configVersion).toBe('v2')
      expect(row.baselineDueAt?.getFullYear()).toBe(2030)
      expect(row.successRunId).not.toBeNull() // evidence kept; the reader judges it by successConfigVersion
      expect(row.successConfigVersion).toBe('v1')
    })

    it('removes rows of jobs outside the catalogue, bounded by the table caps', async () => {
      await db.scheduledJobSummary.create({
        data: {
          jobId: 'removed-job',
          firstRegisteredAt: new Date(),
          lastRegisteredAt: new Date(),
          configVersion: 'v0',
          enabled: true,
          recordedAt: new Date(),
        },
      })
      await db.scheduledJobRun.create({
        data: { runId: randomUUID(), jobId: 'removed-job', startedAt: new Date() },
      })
      await registerAll()
      expect(await db.scheduledJobSummary.count({ where: { jobId: 'removed-job' } })).toBe(0)
      expect(await db.scheduledJobRun.count({ where: { jobId: 'removed-job' } })).toBe(0)
    })
  })

  describe('concurrent recorders', () => {
    it('keeps one consistent snapshot per kind when two recorders write the same job at once', async () => {
      const events = Array.from({ length: 20 }, (_, index) =>
        evidence({
          kind: 'failure',
          code: `code-${index}`,
          startMono: 20_000 + index,
          summary: { counts: { n: index }, codes: [] },
        })
      )
      await Promise.all(events.map((event) => write({ evidence: [event] })))
      const row = await summary('cleanup')
      expect(row.failureCode).toBe('code-19')
      expect(row.failureSummary).toEqual({ counts: { n: 19 }, codes: [] })
    })

    it('stays inside the run caps with many concurrent starts and finishes of one job', async () => {
      const runs = Array.from({ length: 10 }, () => randomUUID())
      await Promise.allSettled(
        runs.flatMap((runId) => [
          write({
            starts: [
              {
                jobId: 'cleanup',
                runId,
                startMono: (startMonos.set(runId, (mono += 10)), mono),
                maxRuntimeMs: 1_800_000,
                clock: clockOf(runId),
              },
            ],
          }),
        ])
      )
      await Promise.allSettled(
        runs.map((runId) =>
          write({
            finishes: [
              {
                jobId: 'cleanup',
                runId,
                outcome: 'success',
                startMono: startMonos.get(runId) ?? 0,
                endMono: (mono += 10),
                durationMs: 1,
                code: null,
                summary: null,
                clock: clockOf(runId),
              },
            ],
          })
        )
      )
      const { open, abandoned, terminal } = await counts('cleanup')
      expect(open).toBeLessThanOrEqual(RUN_CAPS.open)
      expect(abandoned).toBeLessThanOrEqual(RUN_CAPS.abandoned)
      expect(terminal).toBeLessThanOrEqual(RUN_CAPS.terminal)
    })

    it('keeps frequent patches out of a daily flush', async () => {
      const pending = new PendingEvidence()
      pending.put(evidence({ jobId: 'cleanup', cadence: 'daily' }))
      pending.put(evidence({ jobId: 'notification-recovery', cadence: 'frequent' }))
      await writeSnapshot(service, pending.take('event'), catalogue, anchors)
      expect((await summary('notification-recovery')).successRunId).toBeNull()
      await writeSnapshot(service, pending.take('frequent'), catalogue, anchors)
      expect((await summary('notification-recovery')).successRunId).not.toBeNull()
    })
  })
})
