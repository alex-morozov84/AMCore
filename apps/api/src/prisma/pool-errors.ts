import type { PinoLogger } from 'nestjs-pino'
import type { Pool } from 'pg'

/** Own the listener for the entire external pool lifetime, including adapter disposal. */
export function observePoolErrors(
  pool: Pool,
  logger: Pick<PinoLogger, 'error'>,
  shuttingDown: () => boolean
): void {
  pool.on('error', (error: Error & { code?: unknown }) => {
    const sqlState =
      typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : 'unknown'
    // pg discards the failed idle client. Never log its object, connection URL or message.
    logger.error(
      { event: 'prisma.pool_error', phase: shuttingDown() ? 'shutdown' : 'runtime', sqlState },
      'PostgreSQL idle connection failed'
    )
  })
}
