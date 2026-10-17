import type { INestApplication } from '@nestjs/common'
import { Injectable, OnApplicationShutdown } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

/**
 * Runs after Nest has closed the app (onModuleDestroy → beforeApplicationShutdown → connections closed).
 * Flushes buffered logs and lets Node exit naturally after all shutdown hooks
 * complete. Do not call process.exit() here: BullMQ drains workers in the same
 * Nest lifecycle phase, and a synchronous exit can cut an in-flight job drain.
 */
@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private app: INestApplication | null = null

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ShutdownService.name)
  }

  setApp(app: INestApplication): void {
    this.app = app
  }

  onApplicationShutdown(signal?: string): void {
    this.logger.info(`Application shutdown (${signal ?? 'unknown'}), flushing logs...`)
    // Nest has already closed the app here. Write the last line before the flush: Nest re-emits
    // the signal right after this hook, so a line written after the flush can be lost.
    this.logger.info('✅ Application closed successfully')
    try {
      this.app?.flushLogs()
    } catch (error) {
      this.logger.error({ err: error }, 'Error flushing logs during shutdown')
      process.exitCode = 1
    }
  }
}
