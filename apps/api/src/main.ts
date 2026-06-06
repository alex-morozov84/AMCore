import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'
import { cleanupOpenApiDoc } from 'nestjs-zod'

import { AppModule } from './app.module'
import { EnvService } from './env/env.service'
import { ShutdownService } from './shutdown.service'
import { WebModule } from './web.module'
import { WorkerModule } from './worker.module'

type ProcessRole = 'web' | 'worker' | 'all'

/**
 * Pick the root module from PROCESS_ROLE (ADR-041). Read raw from process.env
 * because the role decides which module to build *before* the app (and its
 * ConfigModule) exists. The Zod env schema validates PROCESS_ROLE when the chosen
 * module loads, so an invalid value still fails fast with a clear error.
 */
function rootModuleFor(role: ProcessRole): typeof AppModule {
  switch (role) {
    case 'web':
      return WebModule
    case 'worker':
      return WorkerModule
    case 'all':
    default:
      return AppModule
  }
}

async function bootstrap(): Promise<void> {
  const role = (process.env.PROCESS_ROLE ?? 'all') as ProcessRole
  const isWorker = role === 'worker'

  const app = await NestFactory.create(rootModuleFor(role), { bufferLogs: true, rawBody: true })
  const env = app.get(EnvService)
  const isProduction = env.get('NODE_ENV') === 'production'

  // Use Pino logger
  const logger = app.get(Logger)
  app.useLogger(logger)

  // Flush buffered logs
  app.flushLogs()

  // Cookie parser for refresh tokens
  app.use(cookieParser())

  // Security: HTTP headers
  app.use(helmet())

  // Security: CORS (origin from validated env, already string[])
  app.enableCors({
    origin: env.get('CORS_ORIGIN'),
    credentials: true,
  })

  // Global prefix
  app.setGlobalPrefix('api/v1')

  // Swagger - only in development, and never on the worker (health-only surface)
  if (!isProduction && !isWorker) {
    const config = new DocumentBuilder()
      .setTitle('AMCore API')
      .setDescription('AMCore API documentation')
      .setVersion('0.0.1')
      .addBearerAuth()
      .addCookieAuth('refresh_token')
      .build()

    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document))
  }

  // Native shutdown: Nest listens for SIGTERM/SIGINT, then awaits lifecycle hooks.
  app.enableShutdownHooks()
  app.get(ShutdownService).setApp(app)

  const port = env.get('API_PORT')
  await app.listen(port)

  logger.log(`🚀 AMCore [${role}] running on http://localhost:${port}`)
  if (isWorker) {
    logger.log('⚙️  worker role: processors + cron, health-only HTTP')
  } else if (!isProduction) {
    logger.log(`📚 Swagger docs: http://localhost:${port}/docs`)
  } else {
    logger.log('📚 Swagger docs disabled in production')
  }
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error)
  process.exit(1)
})
