import { Module, type Type } from '@nestjs/common'
import { MODULE_METADATA } from '@nestjs/common/constants'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { createSchemaValidationPipe } from '../src/common/schemas/schema-validation'
import { GcraRedisLimiter } from '../src/infrastructure/throttling'
import { PrismaService } from '../src/prisma'

import { createHttpTestApp } from './create-http-test-app'
import { type E2ETestContext, migrateTestDatabase, noopPinoLogger } from './helpers'
import { TestRedis } from './test-redis'

export async function setupWebhookTestApp(
  controllers: Type<unknown> | Type<unknown>[],
  parserOnlyWorkRoutes = false
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
  const builder = Test.createTestingModule({
    imports: [AppModule, WebhooksModule],
    controllers: Array.isArray(controllers) ? controllers : [controllers],
  })
    .overrideProvider(PinoLogger)
    .useValue(noopPinoLogger)
  if (parserOnlyWorkRoutes) {
    // Fastify refuses duplicate routes. Isolate the existing parser-only controller instead of
    // depending on HTTP route registration order to shadow the guarded production handler.
    const { AdminModule } = await import('../src/core/admin/admin.module')
    const { BackgroundWorkController } =
      await import('../src/core/admin/background-work.controller')
    class ParserAdminModule {}
    Module({
      imports: Reflect.getMetadata(MODULE_METADATA.IMPORTS, AdminModule),
      providers: Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AdminModule),
      exports: Reflect.getMetadata(MODULE_METADATA.EXPORTS, AdminModule),
      controllers: (
        Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AdminModule) as Type<unknown>[]
      ).filter((controller) => controller !== BackgroundWorkController),
    })(ParserAdminModule)
    builder.overrideModule(AdminModule).useModule(ParserAdminModule)
  }
  const moduleFixture: TestingModule = await builder.compile()

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
