import { Prisma, type PrismaClient } from '../../../src/generated/prisma/client'
import type { PrismaService } from '../../../src/prisma'

export function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Pause after a real SQL statement acquired its locks, keeping the real transaction open. */
export function transactionBarrier(
  db: PrismaClient,
  match: (sql: string) => boolean
): { facade: PrismaService; entered: Promise<void>; release(): void } {
  const entered = deferred()
  const release = deferred()
  let armed = true
  const facade = new Proxy(db, {
    get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key)
      return (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
        db.$transaction(
          (tx) =>
            run(
              new Proxy(tx, {
                get(client, field) {
                  const original = Reflect.get(client, field)
                  if (field !== '$queryRaw')
                    return typeof original === 'function' ? original.bind(client) : original
                  return async (...args: unknown[]) => {
                    const result = await Reflect.apply(original, client, args)
                    const sql = Array.isArray(args[0])
                      ? args[0].join('?')
                      : String((args[0] as Prisma.Sql).sql)
                    if (armed && Array.isArray(result) && result.length > 0 && match(sql)) {
                      armed = false
                      entered.resolve()
                      await release.promise
                    }
                    return result
                  }
                },
              })
            ),
          options
        )
    },
  }) as unknown as PrismaService
  return { facade, entered: entered.promise, release: () => release.resolve() }
}

/** Observe actual blocking instead of using a guessed delay or mocking locks. */
export async function waitForBlocked(db: PrismaClient): Promise<void> {
  const deadline = performance.now() + 2000
  while (performance.now() < deadline) {
    const rows = await db.$queryRaw<{ blocked: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
        AND cardinality(pg_blocking_pids(pid)) > 0) AS blocked`
    if (rows[0]?.blocked) return
  }
  throw new Error('Expected a real PostgreSQL lock wait')
}

export async function waitForDatabaseTime(db: PrismaClient, boundary: Date): Promise<void> {
  const deadline = performance.now() + 2000
  while (performance.now() < deadline) {
    const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    if (clock!.now >= boundary) return
  }
  throw new Error('Database clock did not reach the fixture boundary')
}
