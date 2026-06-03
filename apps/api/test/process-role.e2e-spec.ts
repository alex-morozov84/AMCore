import { SchedulerRegistry } from '@nestjs/schedule'
import { Test, type TestingModule } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { AppModule } from '../src/app.module'
import { AdminController } from '../src/core/admin/admin.controller'
import { AuthController } from '../src/core/auth/auth.controller'
import { EmailProcessor } from '../src/infrastructure/email/processors/email.processor'
import { QueueService } from '../src/infrastructure/queue'
import { WebModule } from '../src/web.module'
import { WorkerModule } from '../src/worker.module'

/**
 * Role-composition DI assertions (ADR-041). Lives in the e2e (ESM) project so the
 * full app graph (jose/openid-client) parses. Uses `.compile()` — it resolves the
 * DI graph WITHOUT `onModuleInit`, so no Redis/Postgres connection is made — plus
 * a no-op `PinoLogger` (the real nestjs-pino provider hangs `compile()`).
 */

/* eslint jest/expect-expect: ["error", { "assertFunctionNames": ["expect", "present", "absent"] }] */

type Token = any

const noopPinoLogger = {
  setContext: () => undefined,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  assign: () => undefined,
} as unknown as PinoLogger

async function compileRole(root: Token): Promise<TestingModule> {
  return Test.createTestingModule({ imports: [root] })
    .overrideProvider(PinoLogger)
    .useValue(noopPinoLogger)
    .compile()
}

const present = (m: TestingModule, token: Token): void =>
  expect(() => m.get(token, { strict: false })).not.toThrow()
const absent = (m: TestingModule, token: Token): void =>
  expect(() => m.get(token, { strict: false })).toThrow()

describe('PROCESS_ROLE module composition (ADR-041)', () => {
  beforeAll(() => {
    process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/test?schema=public'
    process.env.REDIS_URL ??= 'redis://localhost:6379'
    process.env.JWT_SECRET ??= 'test-only-jwt-secret-at-least-32-characters-long'
  })

  describe('web', () => {
    let m: TestingModule
    beforeAll(async () => {
      m = await compileRole(WebModule)
    }, 60000)
    afterAll(async () => {
      await m.close()
    })

    it('has queue producers and business controllers', () => {
      present(m, QueueService)
      present(m, AuthController)
      present(m, AdminController)
    })

    it('has NO BullMQ worker and NO scheduler (so @Cron never fires)', () => {
      absent(m, EmailProcessor)
      absent(m, SchedulerRegistry)
    })
  })

  describe('worker', () => {
    let m: TestingModule
    beforeAll(async () => {
      m = await compileRole(WorkerModule)
    }, 60000)
    afterAll(async () => {
      await m.close()
    })

    it('has the BullMQ processor and the scheduler', () => {
      present(m, EmailProcessor)
      present(m, SchedulerRegistry)
    })

    it('has NO business controllers (health-only HTTP surface)', () => {
      absent(m, AuthController)
      absent(m, AdminController)
    })
  })

  describe('all', () => {
    let m: TestingModule
    beforeAll(async () => {
      m = await compileRole(AppModule)
    }, 60000)
    afterAll(async () => {
      await m.close()
    })

    it('composes web + worker: controllers, producer, processor, and scheduler', () => {
      present(m, AuthController)
      present(m, AdminController)
      present(m, QueueService)
      present(m, EmailProcessor)
      present(m, SchedulerRegistry)
    })
  })
})
