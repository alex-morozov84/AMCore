import type { Provider, Type } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { createSchemaValidationPipe } from '../src/common/schemas/schema-validation'
import { IdempotencyModule } from '../src/infrastructure/idempotency'
import { GcraRedisLimiter } from '../src/infrastructure/throttling'
import { PrismaService } from '../src/prisma'

import { createHttpTestApp } from './create-http-test-app'
import {
  type E2ETestContext,
  migrateTestDatabase,
  noopPinoLogger,
  setupE2ETestInfrastructure,
} from './helpers'
import { TestRedis } from './test-redis'

export async function setupIdempotencyTestApp(
  controller: Type<unknown>,
  providers: Provider[]
): Promise<E2ETestContext> {
  const { postgresContainer, redisContainer } = await setupE2ETestInfrastructure()
  const databaseUrl = postgresContainer.getConnectionUri()
  const redisUrl = redisContainer.getConnectionUrl()

  process.env.DATABASE_URL = databaseUrl
  process.env.REDIS_URL = redisUrl
  process.env.E2E_DATABASE_URL = databaseUrl
  process.env.HEALTH_DISK_THRESHOLD_PERCENT = '0.99'

  const { AppModule } = await import('../src/app.module')
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule, IdempotencyModule],
    controllers: [controller],
    providers,
  })
    .overrideProvider(PinoLogger)
    .useValue(noopPinoLogger)
    .compile()

  const app = await createHttpTestApp(moduleFixture, '')
  app.useGlobalPipes(createSchemaValidationPipe())
  // Migrate BEFORE the app's database connections exist (AI migration maintenance-stop guard).
  await migrateTestDatabase(databaseUrl)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const prisma = app.get(PrismaService)
  const cache = await TestRedis.connect(redisContainer)
  const throttlerStorage = app.get(GcraRedisLimiter)
  return { app, prisma, cache, throttlerStorage, postgresContainer, redisContainer }
}
