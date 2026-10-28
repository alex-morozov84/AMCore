import { jest } from '@jest/globals'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { PinoLogger } from 'nestjs-pino'
import { Client, type Pool } from 'pg'

import type { EnvService } from '../src/env/env.service'
import type { MetricsService } from '../src/infrastructure/observability'
import { PrismaService } from '../src/prisma/prisma.service'

import { e2eContainerLabels } from './e2e-owned-containers'

describe('Prisma owned pool lifetime with real PostgreSQL disconnects', () => {
  let container: StartedPostgreSqlContainer
  let admin: Client
  let prisma: PrismaService
  let pool: Pool
  let logged: (event: unknown) => void
  const error = jest.fn((event: unknown) => logged?.(event))

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .start()
    admin = new Client({ connectionString: container.getConnectionUri() })
    await admin.connect()
  }, 120000)
  beforeEach(async () => {
    const values = {
      DATABASE_URL: container.getConnectionUri(),
      DATABASE_POOL_MAX: 1,
      DATABASE_POOL_IDLE_MS: 60000,
      DATABASE_CONNECT_MS: 5000,
      DATABASE_STATEMENT_TIMEOUT_MS: 5000,
      DATABASE_QUERY_TIMEOUT_MS: 5000,
      PROCESS_ROLE: 'worker',
      NODE_ENV: 'test',
      SLOW_QUERY_THRESHOLD_MS: 100,
    }
    const env = { get: (key: keyof typeof values) => values[key] } as EnvService
    const logger = { error, warn: jest.fn(), setContext: jest.fn() } as unknown as PinoLogger
    prisma = new PrismaService(env, logger, {
      incDbSlowQuery: jest.fn(),
    } as unknown as MetricsService)
    pool = (prisma as unknown as { pool: Pool }).pool
    await prisma.onModuleInit()
    error.mockClear()
  })
  afterEach(async () => {
    if (!pool.ended) await prisma.onModuleDestroy()
  })
  afterAll(async () => {
    try {
      await admin?.end()
    } finally {
      await container?.stop()
    }
  })

  async function disconnect(phase: string): Promise<void> {
    const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    const pid = rows[0]?.pid
    expect(pid).toBeDefined()
    const observed = new Promise<unknown>((resolve) => {
      logged = resolve
    })
    await admin.query('SELECT pg_terminate_backend($1)', [pid])
    await expect(observed).resolves.toEqual({
      event: 'prisma.pool_error',
      phase,
      sqlState: '57P01',
    })
  }

  it('logs an idle runtime disconnect, reconnects, and still rejects query errors', async () => {
    await disconnect('runtime')
    await expect(prisma.$queryRaw`SELECT 1 AS value`).resolves.toEqual([{ value: 1 }])
    await expect(prisma.$queryRaw`SELECT 1 / 0`).rejects.toThrow()
  })

  it('handles a real late error after adapter disposal and completes pool teardown', async () => {
    const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
    const pid = rows[0]?.pid
    expect(pid).toBeDefined()
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const atEnd = new Promise<void>((resolve) => {
      entered = resolve
    })
    const end = pool.end.bind(pool)
    jest.spyOn(pool, 'end').mockImplementation(async () => {
      entered()
      await gate
      await end()
    })
    const stopping = prisma.onModuleDestroy()
    try {
      await atEnd
      expect(pool.listenerCount('error')).toBe(1)
      const observed = new Promise<unknown>((resolve) => {
        logged = resolve
      })
      await admin.query('SELECT pg_terminate_backend($1)', [pid])
      await expect(observed).resolves.toEqual({
        event: 'prisma.pool_error',
        phase: 'shutdown',
        sqlState: '57P01',
      })
    } finally {
      release()
      await stopping
    }
    expect(pool.ended).toBe(true)
    expect(pool.totalCount).toBe(0)
  })
})
