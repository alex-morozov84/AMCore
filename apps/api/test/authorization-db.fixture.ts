import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { PrismaPg } from '@prisma/adapter-pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'

export const DEFAULTS_MIGRATION = '20260927180000_explicit_org_authorization_defaults'
export const defaultsMigrationSql = (): string =>
  readFileSync(resolve('prisma/migrations', DEFAULTS_MIGRATION, 'migration.sql'), 'utf8')

export interface AuthorizationDbFixture {
  container: StartedPostgreSqlContainer
  pool: Pool
  prisma: PrismaClient
  environment: NodeJS.ProcessEnv
  deploy: () => void
  seedProcess: () => void
  reset: () => Promise<void>
  audit: (readOnlyRole?: boolean) => Promise<Record<string, unknown>[]>
  close: () => Promise<void>
}

/** No ambient DB: every client and CLI is explicitly bound to this owned container. */
export async function authorizationDbFixture(): Promise<AuthorizationDbFixture> {
  const container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('authorization_test')
    .withUsername('test')
    .withPassword('test')
    .start()
  const databaseUrl = container.getConnectionUri()
  const pool = new Pool({ connectionString: databaseUrl })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  const environment = { ...process.env, DATABASE_URL: databaseUrl, E2E_DATABASE_URL: databaseUrl }
  const deploy = (): void => {
    execFileSync('pnpm', ['prisma', 'migrate', 'deploy'], { env: environment, stdio: 'inherit' })
  }
  const seedProcess = (): void => {
    execFileSync('pnpm', ['exec', 'tsx', 'prisma/seed.ts'], { env: environment, stdio: 'inherit' })
  }
  await pool.query(
    'CREATE SCHEMA IF NOT EXISTS core; CREATE SCHEMA IF NOT EXISTS fitness; CREATE SCHEMA IF NOT EXISTS finance; CREATE SCHEMA IF NOT EXISTS subscriptions'
  )
  deploy()
  return {
    container,
    pool,
    prisma,
    environment,
    deploy,
    seedProcess,
    reset: async () => {
      await pool.query(
        'TRUNCATE core.organizations CASCADE; DELETE FROM core.roles; DELETE FROM core.permissions; DELETE FROM core.users'
      )
    },
    audit: async (readOnlyRole = false) => {
      await container.copyContentToContainer([
        {
          content: readFileSync(resolve('../../scripts/authorization-audit.sql')),
          target: '/tmp/authorization-audit.sql',
        },
      ])
      const result = await container.exec([
        'psql',
        '-U',
        'test',
        '-d',
        'authorization_test',
        '-X',
        '--no-psqlrc',
        '--quiet',
        '--set=ON_ERROR_STOP=1',
        '--set=FETCH_COUNT=200',
        '--tuples-only',
        '--no-align',
        ...(readOnlyRole ? ['--command=SET ROLE authorization_auditor'] : []),
        '--file=/tmp/authorization-audit.sql',
      ])
      if (result.exitCode !== 0) throw new Error(`Audit failed: ${result.output}`)
      const rows = result.output
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line))
      if (rows.at(-1)?.type !== 'footer' || rows.at(-1)?.complete !== true)
        throw new Error('Incomplete authorization audit')
      return rows as Record<string, unknown>[]
    },
    close: async () => {
      await prisma.$disconnect()
      await pool.end()
      await container.stop({ timeout: 10000 })
    },
  }
}
