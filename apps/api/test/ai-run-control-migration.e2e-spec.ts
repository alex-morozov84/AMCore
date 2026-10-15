import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'

import { e2eContainerLabels } from './e2e-owned-containers'

const upgrade = '20261015120000_ai_run_control'
const migrations = join(process.cwd(), 'prisma/migrations')

describe('AI run control maintenance migration', () => {
  let container: StartedPostgreSqlContainer
  let client: Client

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .start()
    client = new Client({
      connectionString: container.getConnectionUri(),
      application_name: 'amcore-t043-migrator',
    })
    await client.connect()
    await client.query('CREATE SCHEMA fitness; CREATE SCHEMA finance; CREATE SCHEMA subscriptions;')
    for (const name of readdirSync(migrations)
      .filter((name) => /^\d/.test(name) && name < upgrade)
      .sort())
      await client.query(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'))
  }, 120000)

  afterAll(async () => {
    await client?.end()
    await container?.stop()
  }, 60000)

  it('rejects an old writer, then seeds a durable gate that retains pause across connections', async () => {
    const migration = readFileSync(join(migrations, upgrade, 'migration.sql'), 'utf8')
    const writer = new Client({
      connectionString: container.getConnectionUri(),
      application_name: 'amcore-worker',
    })
    await writer.connect()
    try {
      await expect(client.query(migration)).rejects.toThrow('ai_run_control_old_writers_connected')
      await client.query('ROLLBACK')
      expect(
        (await client.query("SELECT to_regclass('ai.ai_run_control') AS name")).rows[0].name
      ).toBeNull()
    } finally {
      await writer.end()
    }
    await client.query(migration)
    expect((await client.query('SELECT id, paused, revision FROM ai.ai_run_control')).rows).toEqual(
      [{ id: 1, paused: false, revision: 0 }]
    )
    await client.query('UPDATE ai.ai_run_control SET paused = true WHERE id = 1')
    await client.end()
    client = new Client({ connectionString: container.getConnectionUri() })
    await client.connect()
    expect(
      (await client.query('SELECT paused FROM ai.ai_run_control WHERE id = 1')).rows[0]
    ).toEqual({ paused: true })
    const columns = (
      await client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'ai' AND table_name = 'ai_runs'`)
    ).rows
    expect(columns.map((row) => row.column_name)).toEqual(
      expect.arrayContaining(['inputMessageId', 'retryOfRunId', 'assistantBindingCaptured'])
    )
  })
})
