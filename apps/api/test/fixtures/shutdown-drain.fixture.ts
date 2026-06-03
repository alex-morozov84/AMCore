import { Injectable, Module, type OnApplicationShutdown } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { PinoLogger } from 'nestjs-pino'

import { ShutdownService } from '../../src/shutdown.service'

const drainMs = Number(process.env.DRAIN_MS ?? '300')

@Injectable()
class DrainProbe implements OnApplicationShutdown {
  async onApplicationShutdown(signal?: string): Promise<void> {
    process.stdout.write(`drain:start:${signal ?? 'unknown'}\n`)
    await new Promise((resolve) => setTimeout(resolve, drainMs))
    process.stdout.write('drain:complete\n')
  }
}

const logger = {
  setContext: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as PinoLogger

@Module({
  providers: [
    DrainProbe,
    {
      provide: ShutdownService,
      useFactory: () => new ShutdownService(logger),
    },
    {
      provide: PinoLogger,
      useValue: logger,
    },
  ],
})
class FixtureModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(FixtureModule, { logger: false })
  app.enableShutdownHooks()
  app.get(ShutdownService).setApp(app)
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  process.stdout.write(`ready:${port}\n`)
}

bootstrap().catch((error) => {
  process.stderr.write(
    error instanceof Error ? `${error.stack ?? error.message}\n` : `${String(error)}\n`
  )
  process.exit(1)
})
