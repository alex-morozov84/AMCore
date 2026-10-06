import { CACHE_MANAGER } from '@nestjs/cache-manager'
import type { Type } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import type { Cache } from 'cache-manager'
import cookieParser from 'cookie-parser'
import { PinoLogger } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'

import { configureBodyParser } from '../src/bootstrap/configure-body-parser'
import { GcraRedisLimiter } from '../src/infrastructure/throttling'
import { PrismaService } from '../src/prisma'

import { type E2ETestContext, migrateTestDatabase, noopPinoLogger } from './helpers'

export async function setupWebhookTestApp(
  controllers: Type<unknown> | Type<unknown>[]
): Promise<E2ETestContext> {
  const { postgresContainer, redisContainer } = await import('./helpers').then((m) =>
    m.setupE2ETestInfrastructure()
  )
  const databaseUrl = postgresContainer.getConnectionUri()
  const redisUrl = redisContainer.getConnectionUrl()

  process.env.DATABASE_URL = databaseUrl
  process.env.REDIS_URL = redisUrl
  process.env.E2E_DATABASE_URL = databaseUrl
  process.env.HEALTH_DISK_THRESHOLD_PERCENT = '0.99'

  const { AppModule } = await import('../src/app.module')
  const { WebhooksModule } = await import('../src/infrastructure/webhooks')
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule, WebhooksModule],
    controllers: Array.isArray(controllers) ? controllers : [controllers],
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
