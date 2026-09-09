import pino from 'pino'

import 'server-only'

const isDevelopment = process.env.NODE_ENV !== 'production'

/**
 * Defense-in-depth redaction on top of the explicit, hand-built field lists
 * in `degradation-event.ts`/`server-error.ts`/`primary-unavailable.ts` -
 * those already never spread a caller's object into a log record, but this
 * still censors these path shapes if a future field is ever added under one
 * of these names by mistake, matching the sensitive-field vocabulary
 * `apps/api`'s own Pino config already redacts.
 */
const REDACT_PATHS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  '*.password',
  '*.token',
  '*.authorization',
  '*.cookie',
]

/**
 * The minimal `apps/web` half of the Pino logging decision - not a
 * reproduction of `apps/api`'s request-scoped DI/HTTP-auto-logging stack,
 * just a JSON-in-production/pretty-in-dev instance for the bounded event
 * loggers in this directory. `destination` is exposed for tests to observe
 * real serialized output instead of a mocked `.warn()`/`.error()` call.
 */
export function createServerLogger(destination?: pino.DestinationStream): pino.Logger {
  const options: pino.LoggerOptions = {
    level: isDevelopment ? 'debug' : 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    transport:
      !destination && isDevelopment
        ? {
            target: 'pino-pretty',
            options: { colorize: true, singleLine: true, ignore: 'pid,hostname' },
          }
        : undefined,
  }
  return destination ? pino(options, destination) : pino(options)
}

let instance: pino.Logger | undefined

/**
 * Lazily created so importing this module (e.g. from a test that only needs
 * the types) never spins up `pino-pretty`'s transport worker thread.
 */
export function getServerLogger(): pino.Logger {
  instance ??= createServerLogger()
  return instance
}

/** Test-only: force the next `getServerLogger()` call to build a fresh instance. */
export function resetServerLoggerForTests(): void {
  instance = undefined
}
