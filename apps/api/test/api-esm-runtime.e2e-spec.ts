import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'

import { e2eContainerLabels } from './e2e-owned-containers'
import { esmOperatorContracts } from './support/esm-operator-contracts'
import { esmProcess, freeEsmPort, waitEsmHealth } from './support/esm-process'

let postgres: StartedPostgreSqlContainer | undefined
let redis: StartedRedisContainer | undefined
let env: NodeJS.ProcessEnv

beforeAll(async () => {
  // This suite consumes real emitted artifacts, not Jest's source transformation.
  execFileSync('pnpm', ['run', 'build'], { stdio: 'inherit', timeout: 90_000 })
  postgres = await new PostgreSqlContainer('postgres:18-alpine')
    .withLabels(e2eContainerLabels())
    .withDatabase('amcore_test')
    .withUsername('test')
    .withPassword('test')
    .start()
  redis = await new RedisContainer('redis:7-alpine').withLabels(e2eContainerLabels()).start()
  execFileSync('pnpm', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, E2E_DATABASE_URL: postgres.getConnectionUri() },
    timeout: 60_000,
  })
  env = {
    NODE_ENV: 'test',
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    JWT_SECRET: randomBytes(32).toString('hex'),
    GEOIP_ENABLED: 'false',
    HEALTH_DISK_THRESHOLD_PERCENT: '0.99',
    TELEGRAM_BOT_TOKEN: '',
    WEBHOOK_TELEGRAM_SECRET: '',
    TELEGRAM_WEBHOOK_URL: '',
  }
}, 180_000)

afterAll(async () => {
  const failures: unknown[] = []
  for (const resource of [redis, postgres]) {
    if (resource) {
      try {
        await resource.stop({ timeout: 10_000 })
      } catch (error) {
        failures.push(error)
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, 'ESM fixture cleanup failed')
}, 30_000)

it.each(['web', 'worker', 'all'])(
  'compiled ESM %s preserves HTTP boundaries and closes',
  async (role) => {
    const port = await freeEsmPort()
    const app = esmProcess('main.js', { ...env, API_PORT: String(port), PROCESS_ROLE: role })
    try {
      await waitEsmHealth(port)
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'invalid', password: 'invalid' }),
      })
      expect(response.status).toBe(role === 'worker' ? 404 : 400)
      const board = await fetch(`http://127.0.0.1:${port}/api/v1/admin/queues`)
      expect(board.status).toBe(role === 'worker' ? 404 : 401)
    } finally {
      const exit = await app.finish(true)
      // Nest12 re-emits the requested signal after awaiting shutdown hooks.
      expect(exit).toEqual({ code: null, signal: 'SIGTERM' })
      expect(app.output()).toContain('Application closed successfully')
      await expect(
        fetch(`http://127.0.0.1:${port}/api/v1/health/live`, { signal: AbortSignal.timeout(500) })
      ).rejects.toThrow()
    }
  },
  90_000
)

esmOperatorContracts(() => env)
