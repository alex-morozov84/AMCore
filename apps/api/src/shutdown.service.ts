import type { INestApplication } from '@nestjs/common'
import { Injectable, OnApplicationShutdown } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

type Flushable = { flushSync?: () => void }

/**
 * pino keeps its destination under a private symbol and this app does not import pino itself,
 * so find that symbol by its description. Returns undefined if a pino release renames it.
 */
function pinoDestination(logger: PinoLogger): Flushable | undefined {
  const target = logger.logger as unknown as Record<symbol, Flushable | undefined> | undefined
  if (!target) return undefined
  const key = Object.getOwnPropertySymbols(target).find((s) => s.description === 'pino.stream')
  return key ? target[key] : undefined
}

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
    // Nest has already closed the app here and re-emits the signal right after this hook.
    this.logger.info('✅ Application closed successfully')
    try {
      // Nest's own buffer (bufferLogs), not pino's.
      this.app?.flushLogs()
      // pino's destination is buffered too, and the buffer dies with the process. Neither the
      // async logger.flush(cb) nor waiting for a tick drains it in time; flushSync() does.
      pinoDestination(this.logger)?.flushSync?.()
    } catch (error) {
      this.logger.error({ err: error }, 'Error flushing logs during shutdown')
      process.exitCode = 1
    }
  }
}
