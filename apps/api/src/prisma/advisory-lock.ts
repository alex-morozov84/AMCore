import type { Prisma } from '@/generated/prisma/client'

type PrismaTx = Prisma.TransactionClient

/**
 * Transaction-scoped Postgres advisory lock. Hashed via `hashtextextended`
 * so any string namespace fits into the `bigint` the lock function needs.
 * `${key}` is always parameterized — never string-interpolated — so callers
 * cannot accidentally inject SQL through a lock key. Released automatically
 * when the transaction commits or rolls back.
 *
 * Shared by `AdminService` (`system-role:*` keys) and `SessionService`
 * (`session-coordination:*` keys) so unrelated lock namespaces never
 * collide with each other.
 */
export async function acquireXactLock(tx: PrismaTx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)::bigint)`
}
