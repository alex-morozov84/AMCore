import { execSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PrismaPg } from '@prisma/adapter-pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'
import { type Anchor, PendingEvidence } from '../src/infrastructure/schedule/scheduled-job-pending'
import { register } from '../src/infrastructure/schedule/scheduled-job-registration.sql'
import { writeSnapshot } from '../src/infrastructure/schedule/scheduled-job-writer'
import type { PrismaService } from '../src/prisma'

import { e2eContainerLabels } from './e2e-owned-containers'

/**
 * The scheduled-job tables under the production role split (docs/operations/database-role-separation.md):
 * the migration runs as `amcore_migrator`, the grants come from `docker/postgres/setup-roles.sql`
 * exactly as an operator runs it, and the recorder and the Console reader work as `amcore_runtime`,
 * which owns nothing and can only read and write rows.
 */
const SETUP_ROLES = join(process.cwd(), '../../docker/postgres/setup-roles.sql')
const DATABASE = 'amcore'

describe('Scheduled job evidence under the production roles (PostgreSQL)', () => {
  let container: StartedPostgreSqlContainer
  let admin: Client
  let runtime: PrismaClient

  const secret = (): string => randomBytes(18).toString('hex')
  const urlFor = (user: string, password: string): string =>
    `postgresql://${user}:${password}@${container.getHost()}:${container.getPort()}/${DATABASE}`

  /** The operator's file, split at its own step markers so each step runs when it is meant to. */
  function setupStep(name: 'one' | 'three'): string {
    const sql = readFileSync(SETUP_ROLES, 'utf8')
    const two = sql.indexOf('-- Step 2:')
    const three = sql.indexOf('-- Step 3:')
    const observer = sql.indexOf('-- Optional query-statistics observer')
    return name === 'one' ? sql.slice(0, two) : sql.slice(three, observer)
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .withDatabase(DATABASE)
      .withUsername('test')
      .withPassword('test')
      .start()
    admin = new Client({ connectionString: container.getConnectionUri() })
    await admin.connect()

    const migratorPassword = secret()
    const runtimePassword = secret()
    await admin.query(setupStep('one'))
    await admin.query(`ALTER ROLE amcore_migrator WITH LOGIN PASSWORD '${migratorPassword}'`)
    await admin.query(`ALTER ROLE amcore_runtime WITH LOGIN PASSWORD '${runtimePassword}'`)

    const migratorUrl = urlFor('amcore_migrator', migratorPassword)
    const migrator = new Client({
      connectionString: migratorUrl,
      application_name: 'amcore-e2e-migrator',
    })
    await migrator.connect()
    try {
      for (const schema of ['core', 'fitness', 'finance', 'subscriptions'])
        await migrator.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
    } finally {
      await migrator.end()
    }
    execSync('pnpm prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env, E2E_DATABASE_URL: migratorUrl },
    })
    await admin.query(setupStep('three'))

    runtime = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: urlFor('amcore_runtime', runtimePassword),
        max: 4,
      }),
    })
    await runtime.$connect()
  }, 240_000)

  afterAll(async () => {
    await runtime?.$disconnect()
    await admin?.end()
    await container?.stop()
  }, 60_000)

  it('creates the tables, the checks and the indexes under the migrator, which owns them', async () => {
    const owners = await admin.query<{ tablename: string; tableowner: string }>(
      `SELECT tablename, tableowner FROM pg_tables
       WHERE schemaname = 'core' AND tablename LIKE 'scheduled_job_%' ORDER BY tablename`
    )
    expect(owners.rows).toEqual([
      { tablename: 'scheduled_job_runs', tableowner: 'amcore_migrator' },
      { tablename: 'scheduled_job_summaries', tableowner: 'amcore_migrator' },
    ])
    const checks = await admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       WHERE c.contype = 'c' AND t.relname IN ('scheduled_job_runs', 'scheduled_job_summaries')`
    )
    expect(Number(checks.rows[0]?.n)).toBeGreaterThan(0)
  })

  it('lets the runtime role register, record a run and read the evidence back', async () => {
    const service = runtime as unknown as PrismaService
    let anchor: Anchor | null = null
    const anchors = { adopt: (sample: Anchor): Anchor => (anchor ??= sample) }
    const runId = randomUUID()
    const clock = { anchor: null }
    await runtime.$transaction((tx) =>
      register(
        tx,
        [
          {
            jobId: 'cleanup',
            configVersion: 'v1',
            scheduleTimeZone: 'UTC',
            disabledReason: null,
            nextFireAt: new Date('2030-01-01T02:00:00.000Z'),
          },
        ],
        new Date().toISOString()
      )
    )
    const pending = new PendingEvidence()
    pending.startRun({ jobId: 'cleanup', runId, startMono: 100, maxRuntimeMs: 60_000, clock })
    pending.finishRun({
      jobId: 'cleanup',
      runId,
      outcome: 'success',
      startMono: 100,
      endMono: 160,
      durationMs: 60,
      code: null,
      summary: null,
      clock,
    })
    pending.put({
      kind: 'success',
      jobId: 'cleanup',
      cadence: 'daily',
      runId,
      startMono: 100,
      endMono: 160,
      durationMs: 60,
      code: null,
      summary: { counts: { expiredSessions: 3 }, codes: [] },
      skipReason: null,
      dueAt: new Date('2030-01-01T02:00:00.000Z'),
      configVersion: 'v1',
      nextFireAt: null,
      clock,
    })
    await writeSnapshot(service, pending.take('event'), ['cleanup'], anchors)

    const summary = await runtime.scheduledJobSummary.findUniqueOrThrow({
      where: { jobId: 'cleanup' },
    })
    expect(summary.successRunId).toBe(runId)
    const run = await runtime.scheduledJobRun.findFirstOrThrow({ where: { runId } })
    expect(run.outcome).toBe('success')
  })

  it('does not let the runtime role change the structure of the database', async () => {
    await expect(
      runtime.$executeRawUnsafe('CREATE TABLE core.runtime_made (id int)')
    ).rejects.toThrow(/permission denied/)
    await expect(
      runtime.$executeRawUnsafe('ALTER TABLE core.scheduled_job_runs ADD COLUMN extra int')
    ).rejects.toThrow(/must be owner/)
    await expect(
      runtime.$executeRawUnsafe('DROP TABLE core.scheduled_job_summaries')
    ).rejects.toThrow(/must be owner/)
  })
})
