import type { Type } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { SwaggerModule } from '@nestjs/swagger'
import { Logger } from 'nestjs-pino'

import { configureHttp } from './bootstrap/configure-http.js'
import { createHttpAdapter } from './bootstrap/create-http-adapter.js'
import { resolveTrustProxy } from './common/utils/trust-proxy.js'
import { EnvService } from './env/env.service.js'
import { ShutdownService } from './shutdown.service.js'
import { API_GLOBAL_PREFIX, buildApiDocument } from './swagger.config.js'

type ProcessRole = 'web' | 'worker' | 'all'

/**
 * Pick the root module from PROCESS_ROLE (ADR-041). Read raw from process.env
 * because the role decides which module to build *before* the app (and its
 * ConfigModule) exists. The Zod env schema validates PROCESS_ROLE when the chosen
 * module loads, so an invalid value still fails fast with a clear error.
 */
async function rootModuleFor(role: ProcessRole): Promise<Type<unknown>> {
  switch (role) {
    case 'web':
      return (await import('./web.module.js')).WebModule
    case 'worker':
      return (await import('./worker.module.js')).WorkerModule
    case 'all':
    default:
      return (await import('./app.module.js')).AppModule
  }
}

async function bootstrap(): Promise<void> {
  const role = (process.env.PROCESS_ROLE ?? 'all') as ProcessRole
  const isWorker = role === 'worker'

  const root = await rootModuleFor(role)
  const { BULL_BOARD_MOUNT } =
    await import('./infrastructure/queue/dashboard/bull-board-mount-state.js')
  const app = await NestFactory.create<NestFastifyApplication>(
    root,
    createHttpAdapter(
      '/api/v1/admin/queues',
      resolveTrustProxy(process.env.TRUST_PROXY ?? 'false'),
      BULL_BOARD_MOUNT.mounted
    ),
    {
      bufferLogs: true,
      rawBody: true,
    }
  )
  const env = app.get(EnvService)
  const isProduction = env.get('NODE_ENV') === 'production'

  // Proxy awareness: the native adapter derives `req.ip`/`req.protocol` from `X-Forwarded-*`
  // only for the hops TRUST_PROXY names. Default `false` trusts nothing (req.ip is
  // the socket peer), so forwarded headers can't spoof the client IP; set it to the
  // real proxy topology when running behind a reverse proxy/LB.

  // Use Pino logger
  const logger = app.get(Logger)
  app.useLogger(logger)

  // Flush buffered logs
  app.flushLogs()

  // Explicit request-body size limit for JSON + urlencoded (keeps webhook
  // raw-body capture intact). Shared with the e2e bootstrap so the body-size
  // contract is identical in tests and production.
  // The queue board's own guard comes first: parser, Helmet and CORS must not answer its requests.
  await configureHttp(app, `/${API_GLOBAL_PREFIX}`, true)

  // Security: CORS (origin from validated env, already string[])
  app.enableCors({
    origin: env.get('CORS_ORIGIN'),
    credentials: true,
  })

  // Global prefix
  app.setGlobalPrefix(API_GLOBAL_PREFIX)

  // Swagger - only in development, and never on the worker (health-only surface)
  if (!isProduction && !isWorker) {
    SwaggerModule.setup('docs', app, buildApiDocument(app, API_GLOBAL_PREFIX))
  }

  // Native shutdown: Nest listens for SIGTERM/SIGINT, then awaits lifecycle hooks.
  app.enableShutdownHooks()
  app.get(ShutdownService).setApp(app)

  const port = env.get('API_PORT')
  await app.listen(port, '0.0.0.0')

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
