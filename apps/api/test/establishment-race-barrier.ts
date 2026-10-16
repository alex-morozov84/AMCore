import { scheduler } from 'node:timers/promises'

import type { EstablishmentDatabase } from '../src/core/organizations/establishment-transaction'
import type { PrismaService } from '../src/prisma'

interface TableBarrier {
  db: EstablishmentDatabase
  acquired: Promise<void>
  release: () => void
}

/** Pause after the real table lock. No production hook or elapsed-time assumption. */
export function setupTableBarrier(prisma: PrismaService): TableBarrier {
  return organizationTableBarrier(prisma, 'SHARE ROW EXCLUSIVE')
}

export function creationTableBarrier(prisma: PrismaService): TableBarrier {
  return organizationTableBarrier(prisma, 'ROW EXCLUSIVE')
}

function organizationTableBarrier(
  prisma: PrismaService,
  mode: 'SHARE ROW EXCLUSIVE' | 'ROW EXCLUSIVE'
): TableBarrier {
  let entered!: () => void
  let release!: () => void
  const acquired = new Promise<void>((resolve) => {
    entered = resolve
  })
  const resumed = new Promise<void>((resolve) => {
    release = resolve
  })
  let used = false
  const db = {
    $transaction: (work: (tx: unknown) => unknown, options: unknown) =>
      prisma.$transaction(async (tx) => {
        const proxy = new Proxy(tx, {
          get(target, key) {
            if (key === '$executeRaw')
              return async (...args: unknown[]) => {
                const result = await Reflect.apply(target.$executeRaw, target, args)
                if (
                  !used &&
                  String(args[0]).includes(`LOCK TABLE core.organizations IN ${mode} MODE`)
                ) {
                  used = true
                  entered()
                  await resumed
                }
                return result
              }
            const value = Reflect.get(target, key)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
        return work(proxy)
      }, options as never),
  } as unknown as EstablishmentDatabase
  return { db, acquired, release }
}

export async function waitForDatabaseWaiter(prisma: PrismaService): Promise<void> {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND pid <> pg_backend_pid() AND cardinality(pg_blocking_pids(pid)) > 0) AS waiting`
    if (row?.waiting) return
    await scheduler.yield()
  }
  throw new Error('Expected a controlled PostgreSQL lock waiter')
}
