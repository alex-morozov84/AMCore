import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'

/**
 * The AI run ownership migrations against REAL legacy data (Track C — ADR-054): the state-aware conversion
 * of applied markers, the retry budget and uncertain tool effects, and the maintenance-stop guard that
 * refuses the migration while an old `web` / `worker` / `all` process is still connected to a database that
 * holds AI data. The old migrations are applied first, legacy rows are seeded with the OLD engine's exact
 * column semantics, then the two new migrations run — exactly the operator's upgrade path.
 */
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations') // jest runs from apps/api
const OWNERSHIP = '20261005120000_ai_run_ownership_and_effect_identity'
const CONVERSION = '20261005120100_ai_run_legacy_state_conversion'

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

interface RunRow {
  id: string
  status: string
  attemptCount: number
  leaseEpoch: number
  inputFingerprint: string | null
}

interface InvocationRow {
  id: string
  status: string
  errorCode: string | null
  appliedAt: Date | null
  idempotency: string | null
  executionEpoch: number | null
  originCall: number | null
}

/** Rows keyed by id; asking for a missing id fails the test loudly instead of yielding `undefined`. */
class Rows<T extends { id: string }> {
  constructor(private readonly rows: T[]) {}
  get(id: string): T {
    const row = this.rows.find((r) => r.id === id)
    if (!row) throw new Error(`no row ${id}`)
    return row
  }
  all(): T[] {
    return this.rows
  }
}

const sql = (name: string): string =>
  readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8')

async function startDatabase(): Promise<{ container: StartedPostgreSqlContainer; url: string }> {
  const container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('amcore_migration')
    .withUsername('test')
    .withPassword('test')
    .start()
  return { container, url: container.getConnectionUri() }
}

/** Apply every migration BEFORE the two new ones (the "previous release" schema). */
async function applyPreviousRelease(client: Client): Promise<void> {
  for (const schema of ['core', 'finance', 'fitness', 'subscriptions']) {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
  }
  for (const name of migrationNames().filter((n) => n < OWNERSHIP)) await client.query(sql(name))
}

describe('AI run ownership migrations (e2e)', () => {
  describe('legacy data conversion + maintenance-stop guard', () => {
    let container: StartedPostgreSqlContainer
    let url: string
    let client: Client

    beforeAll(async () => {
      ;({ container, url } = await startDatabase())
      client = new Client({ connectionString: url })
      await client.connect()
      await applyPreviousRelease(client)
      await seedLegacy(client)
    }, 240000)

    afterAll(async () => {
      await client?.end()
      await container?.stop({ timeout: 10_000 })
    })

    async function seedLegacy(db: Client): Promise<void> {
      // The seed writes the OLD engine's exact shape; foreign keys to users are not the point here.
      await db.query("SET session_replication_role = 'replica'")
      await db.query(
        `INSERT INTO "ai"."ai_conversations" (id, "ownerUserId", "updatedAt") VALUES ('c1', 'u1', now())`
      )
      const run = (
        id: string,
        status: string,
        attemptCount: number,
        extra = ''
      ): Promise<unknown> =>
        db.query(
          `INSERT INTO "ai"."ai_runs" (id, "conversationId", status, "modelSnapshot", "attemptCount", "maxAttempts", "updatedAt" ${extra ? ', ' + extra.split('=')[0] : ''})
           VALUES ($1, 'c1', $2::"ai"."AiRunStatus", '{}', $3, 3, now() ${extra ? ', ' + extra.split('=')[1] : ''})`,
          [id, status, attemptCount]
        )
      // retry-budget matrix: legacy count = claims − approval decrements
      await run('q0', 'QUEUED', 0)
      await run('q2', 'QUEUED', 2) // retry-scheduled: count already equals consumed retries
      await run('run1', 'RUNNING', 1) // current claim is not a retry
      await run('run3', 'RUNNING', 3)
      await run('wait1', 'WAITING_APPROVAL', 1)
      await run('done2', 'COMPLETED', 2) // terminal: informational, untouched
      // tool state
      await run('r_applied', 'RUNNING', 1)
      await run('r_rej_applied', 'QUEUED', 0)
      await run('r_rej_pending', 'QUEUED', 0)
      await run('r_succ_nostep', 'RUNNING', 1)
      await run('r_stranded_run', 'RUNNING', 2)
      await run('r_stranded_term', 'FAILED', 2)
      await run('r_failed_open', 'QUEUED', 1)
      await run('r_failed_term', 'FAILED', 1)
      const inv = (
        id: string,
        runId: string,
        status: string,
        errorCode: string | null = null
      ): Promise<unknown> =>
        db.query(
          `INSERT INTO "ai"."ai_tool_invocations" (id, "runId", "toolId", status, "errorCode", "argsSnapshot", "updatedAt")
           VALUES ($1, $2, 'archive_document', $3::"ai"."AiToolInvocationStatus", $4, '{}', now())`,
          [id, runId, status, errorCode]
        )
      await inv('i_applied', 'r_applied', 'SUCCEEDED')
      await inv('i_rej_applied', 'r_rej_applied', 'REJECTED')
      await inv('i_rej_pending', 'r_rej_pending', 'REJECTED')
      await inv('i_succ_nostep', 'r_succ_nostep', 'SUCCEEDED')
      await inv('i_stranded_run', 'r_stranded_run', 'EXECUTING')
      await inv('i_stranded_term', 'r_stranded_term', 'EXECUTING')
      await inv('i_failed_open', 'r_failed_open', 'FAILED', 'tool_execution_failed')
      await inv('i_failed_term', 'r_failed_term', 'FAILED', 'tool_execution_failed')
      const step = (id: string, runId: string, invocationId: string, n: number): Promise<unknown> =>
        db.query(
          `INSERT INTO "ai"."ai_run_steps" (id, "runId", "stepNumber", type, detail, "finishedAt")
           VALUES ($1, $2, $3, 'TOOL_INVOCATION'::"ai"."AiRunStepType", $4::jsonb, now())`,
          [id, runId, n, JSON.stringify({ invocationId, toolCallId: `tc-${invocationId}` })]
        )
      await step('s_applied', 'r_applied', 'i_applied', 1)
      await step('s_rej_applied', 'r_rej_applied', 'i_rej_applied', 1)
      await db.query("SET session_replication_role = 'origin'")
    }

    it('REFUSES the migration while an old amcore web/worker/all process is connected — before any change', async () => {
      for (const applicationName of ['amcore-web', 'amcore-worker', 'amcore-all']) {
        const writer = new Client({ connectionString: url, application_name: applicationName })
        await writer.connect()
        try {
          await expect(client.query(sql(OWNERSHIP))).rejects.toThrow(
            /ai_run_migration_old_writers_connected/
          )
        } finally {
          await writer.end()
        }
      }
      // Nothing was applied: the new columns do not exist yet.
      const columns = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'ai' AND table_name = 'ai_runs' AND column_name = 'leaseEpoch'`
      )
      expect(columns.rowCount).toBe(0)
    })

    it('does not trip on unrelated sessions (a migrator, an admin tool)', async () => {
      const other = new Client({ connectionString: url, application_name: 'psql' })
      await other.connect()
      try {
        await expect(client.query(sql(OWNERSHIP))).resolves.toBeDefined()
      } finally {
        await other.end()
      }
    })

    it('converts legacy state without fabricating history or authorizing a replay', async () => {
      await client.query(sql(CONVERSION))

      const runs = new Rows(
        (
          await client.query<RunRow>(
            `SELECT id, status::text, "attemptCount", "leaseEpoch", "inputFingerprint" FROM "ai"."ai_runs"`
          )
        ).rows
      )
      // Retry budget: QUEUED keeps its consumed retries; RUNNING / WAITING_APPROVAL drop the current/parking claim.
      expect(runs.get('q0').attemptCount).toBe(0)
      expect(runs.get('q2').attemptCount).toBe(2)
      expect(runs.get('run1').attemptCount).toBe(0)
      expect(runs.get('run3').attemptCount).toBe(2)
      expect(runs.get('wait1').attemptCount).toBe(0)
      expect(runs.get('done2').attemptCount).toBe(2) // terminal rows are informational and untouched
      // No history is invented: legacy runs stay at epoch 0 with no attempt rows and no fingerprint.
      expect(runs.all().every((r) => r.leaseEpoch === 0)).toBe(true)
      expect(runs.all().every((r) => r.inputFingerprint === null)).toBe(true)
      expect(
        (await client.query(`SELECT count(*)::int AS n FROM "ai"."ai_run_attempts"`)).rows[0].n
      ).toBe(0)

      const invocations = new Rows(
        (
          await client.query<InvocationRow>(
            `SELECT id, status::text, "errorCode", "appliedAt", idempotency, "executionEpoch", "originCall" FROM "ai"."ai_tool_invocations"`
          )
        ).rows
      )
      // Applied marker: derived ONLY from an existing ordering step.
      expect(invocations.get('i_applied').appliedAt).toBeInstanceOf(Date)
      expect(invocations.get('i_rej_applied').appliedAt).toBeInstanceOf(Date)
      expect(invocations.get('i_rej_pending').appliedAt).toBeNull() // a genuine pending decision stays pending
      expect(invocations.get('i_succ_nostep').appliedAt).toBeNull() // success is never fabricated (fails closed at runtime)
      // Effect certainty: a stranded EXECUTING is UNKNOWN on a running AND a terminal run; an ambiguous
      // FAILED becomes UNKNOWN only while its run is still open.
      expect(invocations.get('i_stranded_run').status).toBe('OUTCOME_UNKNOWN')
      expect(invocations.get('i_stranded_term').status).toBe('OUTCOME_UNKNOWN')
      expect(invocations.get('i_failed_open').status).toBe('OUTCOME_UNKNOWN')
      expect(invocations.get('i_failed_term').status).toBe('FAILED') // terminal run keeps its known evidence
      expect(invocations.get('i_failed_term').errorCode).toBe('tool_execution_failed')
      // Terminal run status is untouched by the uncertainty classification.
      expect(runs.get('r_stranded_term').status).toBe('FAILED')
      // Legacy rows carry no execution identity: a NULL class is treated as side-effecting by consumers.
      for (const legacy of invocations.all()) {
        expect(legacy.idempotency).toBeNull()
        expect(legacy.originCall).toBeNull()
        expect(legacy.executionEpoch).toBeNull()
      }
    })

    it('every legacy ordering step references an applied invocation after conversion (consistency check)', async () => {
      const orphans = await client.query(
        `SELECT s.id FROM "ai"."ai_run_steps" s
         JOIN "ai"."ai_tool_invocations" i ON i.id = s.detail ->> 'invocationId'
         WHERE s.type = 'TOOL_INVOCATION'::"ai"."AiRunStepType" AND i."appliedAt" IS NULL`
      )
      expect(orphans.rowCount).toBe(0)
    })

    it('enforces the unique action identity (runId, originCall) for new rows and exempts legacy NULLs', async () => {
      await client.query(`SET session_replication_role = 'replica'`)
      await client.query(
        `INSERT INTO "ai"."ai_runs" (id, "conversationId", status, "modelSnapshot", "updatedAt") VALUES ('fresh', 'c1', 'QUEUED', '{}', now())`
      )
      const insert = (id: string, originCall: number | null): Promise<unknown> =>
        client.query(
          `INSERT INTO "ai"."ai_tool_invocations" (id, "runId", "toolId", "originCall", "updatedAt") VALUES ($1, 'fresh', 't', $2, now())`,
          [id, originCall]
        )
      await insert('n1', null)
      await insert('n2', null) // legacy NULLs never collide
      await insert('o1', 1)
      await expect(insert('o2', 1)).rejects.toThrow(/ai_tool_invocations_runId_originCall_key/) // one action = one row
      await client.query(`SET session_replication_role = 'origin'`)
    })
  })

  describe('fresh install (empty AI tables)', () => {
    let container: StartedPostgreSqlContainer
    let url: string
    let client: Client

    beforeAll(async () => {
      ;({ container, url } = await startDatabase())
      client = new Client({ connectionString: url })
      await client.connect()
      await applyPreviousRelease(client)
    }, 240000)

    afterAll(async () => {
      await client?.end()
      await container?.stop({ timeout: 10_000 })
    })

    it('STILL refuses while a named old writer is connected: an empty table proves nothing about its later writes', async () => {
      const writer = new Client({ connectionString: url, application_name: 'amcore-all' })
      await writer.connect()
      try {
        // No AI rows exist, yet the guard is unconditional: the writer could insert during, or keep
        // writing unfenced after, the conversion.
        expect(
          (await client.query(`SELECT count(*)::int AS n FROM "ai"."ai_runs"`)).rows[0].n
        ).toBe(0)
        await expect(client.query(sql(OWNERSHIP))).rejects.toThrow(
          /ai_run_migration_old_writers_connected/
        )
      } finally {
        await writer.end()
      }
    })

    it('guards the conversion migration too: a writer that connects after the schema migration still blocks it', async () => {
      await client.query(sql(OWNERSHIP))
      const writer = new Client({ connectionString: url, application_name: 'amcore-worker' })
      await writer.connect()
      try {
        await expect(client.query(sql(CONVERSION))).rejects.toThrow(
          /ai_run_migration_old_writers_connected/
        )
      } finally {
        await writer.end()
      }
    })

    it('applies cleanly once no named writer is connected (other clients do not matter)', async () => {
      const other = new Client({ connectionString: url, application_name: 'amcore-e2e-migrator' })
      await other.connect()
      try {
        await client.query(sql(CONVERSION))
      } finally {
        await other.end()
      }
      const epoch = await client.query(
        `SELECT column_default FROM information_schema.columns WHERE table_schema = 'ai' AND table_name = 'ai_runs' AND column_name = 'leaseEpoch'`
      )
      expect(epoch.rows[0].column_default).toBe('0')
    })
  })
})
