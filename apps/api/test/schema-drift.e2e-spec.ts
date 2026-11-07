import { execFileSync } from 'node:child_process'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'

import { e2eContainerLabels } from './e2e-owned-containers'
import { migrateTestDatabase } from './helpers'

describe('migration history and Prisma schema agreement', () => {
  let container: StartedPostgreSqlContainer | undefined

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .start()
    await migrateTestDatabase(container.getConnectionUri())
  }, 120_000)

  afterAll(async () => {
    await container?.stop()
  }, 60_000)

  it('has no schema changes after deploying the full migration history', () => {
    const output = execFileSync(
      'pnpm',
      [
        'prisma',
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma',
        '--script',
        '--exit-code',
      ],
      {
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, E2E_DATABASE_URL: container!.getConnectionUri() },
      }
    )
    // A CLI/config failure can exit zero without comparing anything.
    expect(output.split('\n')).toContain('-- This is an empty migration.')
  })
})
