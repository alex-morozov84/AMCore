import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'

const upgrade = '20261007180000_ai_gateway_consistency'
describe('maintenance-only AI execution contract upgrade (real preceding migrations)', () => {
  let container: StartedPostgreSqlContainer
  let migrator: Client
  let sql: string
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine').start()
    migrator = new Client({
      connectionString: container.getConnectionUri(),
      application_name: 'fixture-migrator',
    })
    await migrator.connect()
    for (const schema of ['core', 'fitness', 'finance', 'subscriptions'])
      await migrator.query(`CREATE SCHEMA ${schema}`)
    const root = resolve('prisma/migrations')
    for (const migration of (await readdir(root))
      .filter((name) => /^\d/.test(name) && name < upgrade)
      .sort()) {
      await migrator.query(await readFile(resolve(root, migration, 'migration.sql'), 'utf8'))
    }
    sql = await readFile(resolve(root, upgrade, 'migration.sql'), 'utf8')
  }, 120000)
  afterAll(async () => {
    await migrator?.end()
    await container?.stop()
  }, 120000)

  it.each(['web', 'worker', 'all'])(
    'refuses while old amcore-%s role is connected, without partial DDL',
    async (role) => {
      const old = new Client({
        connectionString: container.getConnectionUri(),
        application_name: `amcore-${role}`,
      })
      await old.connect()
      try {
        await migrator.query('BEGIN')
        await expect(migrator.query(sql)).rejects.toThrow('Stop all AMCore API roles')
        await migrator.query('ROLLBACK')
        const columns = await migrator.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='ai' AND table_name='ai_runs' AND column_name='providerRetryRestriction'"
        )
        expect(columns.rows).toHaveLength(0)
      } finally {
        await migrator.query('ROLLBACK')
        await old.end()
      }
    }
  )

  it('applies only after all roles stop; adds nullable JSON without rewriting history/snapshots', async () => {
    const before = await migrator.query('SELECT count(*)::int AS n FROM ai.ai_run_attempts')
    await migrator.query('BEGIN')
    await migrator.query(sql)
    await migrator.query('COMMIT')
    const columns = await migrator.query(
      "SELECT is_nullable, data_type FROM information_schema.columns WHERE table_schema='ai' AND table_name='ai_runs' AND column_name='providerRetryRestriction'"
    )
    expect(columns.rows).toEqual([{ is_nullable: 'YES', data_type: 'jsonb' }])
    expect(
      (await migrator.query('SELECT count(*)::int AS n FROM ai.ai_run_attempts')).rows
    ).toEqual(before.rows)
    expect(
      (
        await migrator.query(
          'SELECT classification FROM ai.classify_provider_retry_restriction(NULL,clock_timestamp())'
        )
      ).rows
    ).toEqual([{ classification: 'unrestricted' }])
  })
})
