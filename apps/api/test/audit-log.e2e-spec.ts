import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { execSync } from 'child_process'
import { Client } from 'pg'

describe('AuditLog append-only trigger', () => {
  let client: Client | null = null
  let databaseUrl = ''
  let container: StartedPostgreSqlContainer | null = null

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
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
})
