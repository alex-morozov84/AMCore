import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'
import { cleanupOpenApiDoc } from 'nestjs-zod'

import { AppModule } from './app.module'
import { EnvService } from './env/env.service'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  const env = app.get(EnvService)

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

  // Swagger - only in development
  if (env.get('NODE_ENV') !== 'production') {
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

  // Enable graceful shutdown hooks
  app.enableShutdownHooks()

  const port = env.get('API_PORT')
  await app.listen(port)

  logger.log(`🚀 API running on http://localhost:${port}`)
  logger.log(`📚 Swagger docs: http://localhost:${port}/docs`)

  // Graceful shutdown handlers
  const signals = ['SIGTERM', 'SIGINT'] as const

  for (const signal of signals) {
    process.on(signal, async () => {
      logger.log(`${signal} received, starting graceful shutdown...`)

      try {
        // Stop accepting new connections
        await app.close()
        logger.log('✅ Application closed successfully')

        // Flush remaining logs to disk
        app.flushLogs()
        logger.log('✅ Logs flushed')

        process.exit(0)
      } catch (error) {
        logger.error('❌ Error during shutdown:', error)
        process.exit(1)
      }
    })
  }
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error)
  process.exit(1)
})
