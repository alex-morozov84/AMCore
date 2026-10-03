import { Pool } from 'pg'

import type { Prisma } from '../../src/generated/prisma/client'
import type { PrismaService } from '../../src/prisma'
const jest = import.meta.jest
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Test-only fence after the real org row lock; other app transactions stay untouched. */
export function holdMemberTransaction(
  prisma: PrismaService,
  memberSetOnly = true,
  trace?: string[]
): { entered: Promise<void>; release: () => void; restore: () => void } {
  const original = prisma.$transaction.bind(prisma)
  const entered = deferred()
  const release = deferred()
  let captured = false
  const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: { timeout?: number }
  ) => {
    if ((memberSetOnly && options?.timeout !== 4000) || captured) return original(work, options)
    captured = true
    return original(
      async (tx) =>
        work(
          new Proxy(tx, {
            get(target, key) {
              if (key === '$executeRaw')
                return async (...args: unknown[]) => {
                  const value = await (target.$executeRaw as (...a: unknown[]) => Promise<unknown>)(
                    ...args
                  )
                  if (String(args[0]).includes('pg_advisory_xact_lock')) trace?.push('advisory')
                  return value
                }
              if (key === 'orgInvite' && trace)
                return new Proxy(target.orgInvite, {
                  get(model, name) {
                    if (!['findFirst', 'update', 'create'].includes(String(name)))
                      return Reflect.get(model, name)
                    return async (...args: unknown[]) => {
                      trace.push(`invite:${String(name)}`)
                      return (Reflect.get(model, name) as (...a: unknown[]) => Promise<unknown>)(
                        ...args
                      )
                    }
                  },
                })
              if (key !== '$queryRaw') return Reflect.get(target, key)
              return async (...args: unknown[]) => {
                const value = await (target.$queryRaw as (...a: unknown[]) => Promise<unknown>)(
                  ...args
                )
                if (!String(args[0]).includes('core.organizations')) return value
                trace?.push('parent')
                entered.resolve()
                await release.promise
                return value
              }
            },
          })
        ),
      options
    )
  }) as never)
  return {
    entered: entered.promise,
    release: release.resolve,
    restore: () => {
      release.resolve()
      spy.mockRestore()
    },
  }
}
export async function waitForDbBlock(pool: Pool): Promise<void> {
  const end = Date.now() + 3000
  while (Date.now() < end) {
    const result = await pool.query(
      'SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0'
    )
    if (result.rowCount) return
  }
  throw new Error('No actual DB waiter observed')
}
