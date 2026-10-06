import { CACHE_MANAGER } from '@nestjs/cache-manager'
import type { Provider, Type } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test, type TestingModule } from '@nestjs/testing'
import type { Cache } from 'cache-manager'
import cookieParser from 'cookie-parser'
import { PinoLogger } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'

import { configureBodyParser } from '../src/bootstrap/configure-body-parser'
import { IdempotencyModule } from '../src/infrastructure/idempotency'
import { GcraRedisLimiter } from '../src/infrastructure/throttling'
import { PrismaService } from '../src/prisma'

import {
  type E2ETestContext,
  migrateTestDatabase,
  noopPinoLogger,
  setupE2ETestInfrastructure,
} from './helpers'

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

  const app = moduleFixture.createNestApplication<NestExpressApplication>({ rawBody: true })
  configureBodyParser(app, '')
  app.use(cookieParser())
  app.useGlobalPipes(new ZodValidationPipe())
  // Migrate BEFORE the app's database connections exist (AI migration maintenance-stop guard).
  await migrateTestDatabase(databaseUrl)
  await app.init()

  const prisma = app.get(PrismaService)
  const cache = app.get<Cache>(CACHE_MANAGER)
  const throttlerStorage = app.get(GcraRedisLimiter)
  return { app, prisma, cache, throttlerStorage, postgresContainer, redisContainer }
}
