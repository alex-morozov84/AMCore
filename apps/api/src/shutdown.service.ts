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
      process.exit(1)
    }
    process.exit(0)
  }
}
