import { CACHE_MANAGER } from '@nestjs/cache-manager'
import type { Type } from '@nestjs/common'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { ThrottlerStorage } from '@nestjs/throttler'
import type { Cache } from 'cache-manager'
import { execSync } from 'child_process'
import cookieParser from 'cookie-parser'
import { PinoLogger } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'

import { RedisThrottlerStorage } from '../src/infrastructure/throttling'
import { PrismaService } from '../src/prisma'

import { type E2ETestContext, noopPinoLogger } from './helpers'

export async function setupWebhookTestApp(controller: Type<unknown>): Promise<E2ETestContext> {
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
    controllers: [controller],
  })
    .overrideProvider(PinoLogger)
    .useValue(noopPinoLogger)
    .compile()

  const app = moduleFixture.createNestApplication({ rawBody: true })
  app.use(cookieParser())
  app.useGlobalPipes(new ZodValidationPipe())
  await app.init()

  const prisma = app.get(PrismaService)
  const cache = app.get<Cache>(CACHE_MANAGER)
  const throttlerStorage = app.get<RedisThrottlerStorage>(ThrottlerStorage as never)
  await ensureSchemas(prisma, databaseUrl)
  return { app, prisma, cache, throttlerStorage, postgresContainer, redisContainer }
}

async function ensureSchemas(prisma: PrismaService, databaseUrl: string): Promise<void> {
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS core')
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS fitness')
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS finance')
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS subscriptions')

  execSync('pnpm prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, E2E_DATABASE_URL: databaseUrl },
  })
}
