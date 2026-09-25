import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { execSync } from 'child_process'
import { Client } from 'pg'

describe('AuditLog append-only trigger', () => {
  let client: Client | null = null
  let databaseUrl = ''
  let container: StartedPostgreSqlContainer | null = null

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('amcore_test')
      .withUsername('test')
      .withPassword('test')
      .start()

    databaseUrl = container.getConnectionUri()
    client = new Client({ connectionString: databaseUrl })
    await client.connect()
    await client.query('CREATE SCHEMA IF NOT EXISTS core')
    await client.query('CREATE SCHEMA IF NOT EXISTS finance')
    await client.query('CREATE SCHEMA IF NOT EXISTS fitness')
    await client.query('CREATE SCHEMA IF NOT EXISTS subscriptions')

    execSync('pnpm prisma migrate deploy', {
      env: { ...process.env, E2E_DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    })
  }, 120_000)

  afterAll(async () => {
    if (client) await client.end()
    if (container) await container.stop({ timeout: 10_000 })
  })

  it('rejects direct UPDATE, DELETE, and TRUNCATE on core.audit_log', async () => {
    await client!.query(`
      INSERT INTO core.audit_log
      (id, "createdAt", "actorType", action, category, metadata)
      VALUES ('audit_1', now(), 'SYSTEM', 'auth.step_up_failed', 'SECURITY', '{}'::jsonb)
    `)

    await expect(
      client!.query(`UPDATE core.audit_log SET action = 'mutated' WHERE id = 'audit_1'`)
    ).rejects.toThrow(/append-only/i)
    await expect(client!.query(`DELETE FROM core.audit_log WHERE id = 'audit_1'`)).rejects.toThrow(
      /append-only/i
    )
    await expect(client!.query('TRUNCATE TABLE core.audit_log')).rejects.toThrow(/append-only/i)
  }, 120_000)

  it('backfills unique private keys on a large old table without disabling append-only', async () => {
    await client!.query('ALTER TABLE core.audit_log DROP COLUMN "cursorKey"')
    await client!.query(`
      INSERT INTO core.audit_log
        (id, "createdAt", "actorType", "actorId", action, "targetId", "organizationId", category, metadata)
      SELECT 'seed_' || n::text,
        now() - (n % 45) * interval '1 day' - (n % 3600) * interval '1 second',
        'SYSTEM', CASE WHEN n % 1000 = 0 THEN 'rare_actor' ELSE 'common_actor' END,
        CASE WHEN n % 1000 = 0 THEN 'admin.user.system_role_changed' ELSE 'auth.step_up_failed' END,
        CASE WHEN n % 500 = 0 THEN 'rare_target' ELSE NULL END,
        CASE WHEN n % 333 = 0 THEN 'rare_org' ELSE NULL END,
        'SECURITY', '{}'::jsonb
      FROM generate_series(1, 100000) AS n
    `)
    const migration = readFileSync(
      join(process.cwd(), 'prisma/migrations', '20260923000000_audit_cursor_key', 'migration.sql'),
      'utf8'
    )
    const started = Date.now()
    await client!.query(migration)
    const migrationMs = Date.now() - started
    const keys = await client!.query(`SELECT count(*)::int AS rows,
      count(DISTINCT "cursorKey")::int AS keys FROM core.audit_log`)
    expect(keys.rows[0]).toEqual({ rows: 100001, keys: 100001 })
    await expect(
      client!.query(`UPDATE core.audit_log SET action = 'bad' WHERE id = 'audit_1'`)
    ).rejects.toThrow(/append-only/i)
    await expect(client!.query(`DELETE FROM core.audit_log WHERE id = 'audit_1'`)).rejects.toThrow(
      /append-only/i
    )
    await expect(client!.query('TRUNCATE core.audit_log')).rejects.toThrow(/append-only/i)

    const probes = [
      `SELECT id FROM core.audit_log WHERE "createdAt" >= now() - interval '31 days'
        ORDER BY "createdAt" DESC, id DESC LIMIT 51`,
      `SELECT id FROM core.audit_log WHERE "createdAt" >= now() - interval '31 days'
        AND "actorId" = 'rare_actor' ORDER BY "createdAt" DESC, id DESC LIMIT 51`,
      `SELECT id FROM core.audit_log WHERE "createdAt" >= now() - interval '31 days'
        AND action = 'admin.user.system_role_changed'
        ORDER BY "createdAt" DESC, id DESC LIMIT 51`,
      `SELECT id FROM core.audit_log WHERE "createdAt" >= now() - interval '31 days'
        AND "organizationId" = 'rare_org'
        ORDER BY "createdAt" DESC, id DESC LIMIT 51`,
      `SELECT id FROM core.audit_log WHERE "createdAt" >= now() - interval '31 days'
        AND "targetId" = 'rare_target'
        ORDER BY "createdAt" DESC, id DESC LIMIT 51`,
      `SELECT id FROM core.audit_log WHERE "cursorKey" =
        (SELECT "cursorKey" FROM core.audit_log WHERE id = 'seed_100000')`,
      `SELECT id FROM core.audit_log WHERE "createdAt" >= now() - interval '31 days'
        AND ("createdAt", id) <
          (SELECT "createdAt", id FROM core.audit_log WHERE id = 'seed_99999')
        ORDER BY "createdAt" DESC, id DESC LIMIT 51`,
    ]
    const plans: Array<{ ms: number; hit: number; read: number; node: string }> = []
    for (const probe of probes) {
      const result = await client!.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${probe}`)
      const plan = result.rows[0]['QUERY PLAN'][0]
      plans.push({
        ms: plan['Execution Time'],
        hit: plan.Plan['Shared Hit Blocks'],
        read: plan.Plan['Shared Read Blocks'],
        node: plan.Plan['Node Type'],
      })
      expect(plan['Execution Time']).toBeLessThan(2000)
    }
    // This is a local PostgreSQL 18 rehearsal, not a production lock-time guarantee.
    process.stdout.write(
      `T003 audit migration ${migrationMs}ms; query plans ${JSON.stringify(plans)}\n`
    )
  }, 120_000)
})
