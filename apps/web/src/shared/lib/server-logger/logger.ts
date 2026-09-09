import pino from 'pino'

import 'server-only'

const isDevelopment = process.env.NODE_ENV !== 'production'

let instance: pino.Logger | undefined

/**
 * The minimal `apps/web` half of `ADR-005`'s Pino decision — not a
 * reproduction of `apps/api`'s `nestjs-pino`/`nestjs-cls` stack (no
 * per-request DI, no HTTP auto-logging), just a JSON-in-production/
 * pretty-in-dev instance for the bounded event loggers in this directory.
 * Lazily created so importing this module (e.g. from a test that only needs
 * the types) never spins up `pino-pretty`'s transport worker thread.
 */
export function getServerLogger(): pino.Logger {
  instance ??= pino({
    level: isDevelopment ? 'debug' : 'info',
    transport: isDevelopment
      ? {
          target: 'pino-pretty',
          options: { colorize: true, singleLine: true, ignore: 'pid,hostname' },
        }
      : undefined,
  })
  return instance
}
