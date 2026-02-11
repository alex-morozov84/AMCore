import type { INestApplication } from '@nestjs/common'
import { Injectable, OnApplicationShutdown } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

/**
 * Runs after Nest has closed the app (onModuleDestroy → beforeApplicationShutdown → connections closed).
 * Flushes logs and exits the process, since app.close() does not terminate the Node process.
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
    try {
      this.app?.flushLogs()
      this.logger.info('✅ Application closed successfully')
    } catch (error) {
      this.logger.error({ err: error }, 'Error flushing logs during shutdown')
      // In tests, don't call process.exit() as it prevents Jest from printing test summary
      if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
        process.exit(1)
      }
      return
    }
    // In tests, don't call process.exit() as it prevents Jest from printing test summary
    if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
      process.exit(0)
    }
  }
}
