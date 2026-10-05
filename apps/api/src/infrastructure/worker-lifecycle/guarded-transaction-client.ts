import type { Prisma } from '@/generated/prisma/client'

/**
 * Thrown by a guarded transaction client when a query is attempted after the shutdown latch
 * was sealed. It propagates through the interactive transaction callback (and any nested
 * helper — helpers never swallow errors around queries) so Prisma rolls the WHOLE transaction
 * back. It is converted to a `CUTOFF` result only OUTSIDE the transaction, by the latch.
 */
export class ShutdownCutoffError extends Error {
  constructor() {
    super('worker_shutdown_cutoff')
    this.name = 'ShutdownCutoffError'
  }
}

/** Raw-query entry points of a transaction client; each is guarded individually. */
const GUARDED_RAW_METHODS: ReadonlySet<string> = new Set([
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
])

/**
 * Prisma returns lazy "PrismaPromise"s: the request is only sent when `.then` is first called.
 * Consume `.then` synchronously inside the guarded call so the query starts at the moment the
 * guard checked the latch — a captured promise cannot first execute after the seal.
 */
function startNow(result: unknown): unknown {
  if (
    result !== null &&
    typeof result === 'object' &&
    typeof (result as PromiseLike<unknown>).then === 'function'
  ) {
    return new Promise((resolve, reject) => {
      ;(result as PromiseLike<unknown>).then(resolve, reject)
    })
  }
  return result
}

function guardMethod(
  method: (...args: unknown[]) => unknown,
  owner: object,
  isSealed: () => boolean
): (...args: unknown[]) => unknown {
  return (...args) => {
    if (isSealed()) throw new ShutdownCutoffError()
    return startNow(Reflect.apply(method, owner, args))
  }
}

function guardDelegate(delegate: object, isSealed: () => boolean): object {
  return new Proxy(delegate, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target)
      if (typeof prop === 'symbol' || typeof value !== 'function') return undefined
      return guardMethod(value as (...args: unknown[]) => unknown, target, isSealed)
    },
  })
}

/**
 * A narrow facade over a Prisma interactive-transaction client: every model-delegate method and
 * raw-query method first checks the latch and, once sealed, throws `ShutdownCutoffError` instead
 * of issuing the query. Anything else (internal/underscore members, `$transaction`, …) is not
 * exposed, so the facade is not an escape hatch to the raw client. The single type cast below is
 * the deliberate seam, covered by a contract test against the real generated client.
 */
export function guardTransactionClient(
  tx: Prisma.TransactionClient,
  isSealed: () => boolean
): Prisma.TransactionClient {
  const facade = new Proxy(tx as object, {
    get(target, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined
      const value: unknown = Reflect.get(target, prop, target)
      if (GUARDED_RAW_METHODS.has(prop) && typeof value === 'function') {
        return guardMethod(value as (...args: unknown[]) => unknown, target, isSealed)
      }
      if (
        !prop.startsWith('$') &&
        !prop.startsWith('_') &&
        value !== null &&
        (typeof value === 'object' || typeof value === 'function')
      ) {
        return guardDelegate(value, isSealed)
      }
      throw new Error('guarded_tx_unsupported_access')
    },
  })
  return facade as Prisma.TransactionClient
}
