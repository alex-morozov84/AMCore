import { Pool } from 'pg'

import type { Prisma } from '../../src/generated/prisma/client'
import type { PrismaService } from '../../src/prisma'

import { deferred } from './organization-members-race'
const jest = import.meta.jest

/** One exact SQL/model boundary in one real transaction, with its backend PID. */
export function invitationFence(
  prisma: PrismaService,
  matches: (model: string, method: string, args: unknown[]) => boolean
): { entered: Promise<void>; release: () => void; pid: () => number; restore: () => void } {
  const entered = deferred()
  const release = deferred()
  const original = prisma.$transaction.bind(prisma)
  let captured = false
  let pid = 0
  const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: object
  ) => {
    if (captured) return original(work, options)
    captured = true
    return original(async (tx) => {
      pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid
      const intercept = (model: string, target: object): object =>
        new Proxy(target, {
          get(object, method) {
            const value = Reflect.get(object, method)
            if (typeof value !== 'function') return value
            return async (...args: unknown[]) => {
              const result = await value.apply(object, args)
              if (matches(model, String(method), args)) {
                entered.resolve()
                await release.promise
              }
              return result
            }
          },
        })
      return work(
        new Proxy(tx, {
          get(target, method) {
            const value = Reflect.get(target, method)
            if (typeof value === 'function') return Reflect.get(intercept('$sql', target), method)
            if (typeof value === 'object' && value) return intercept(String(method), value)
            return value
          },
        })
      )
    }, options)
  }) as never)
  return {
    entered: entered.promise,
    release: release.resolve,
    pid: () => pid,
    restore: () => {
      release.resolve()
      spy.mockRestore()
    },
  }
}

export async function observeInvitationWait(
  pool: Pool,
  blocker: number,
  query: string
): Promise<number> {
  const deadline = Date.now() + 1500
  while (Date.now() < deadline) {
    const result = await pool.query(
      'SELECT pid, query FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) AND query LIKE $2',
      [blocker, `%${query}%`]
    )
    if (result.rowCount) return result.rows[0].pid as number
  }
  throw new Error(`Expected waiter on backend ${blocker}: ${query}`)
}

export async function databaseClockPast(pool: Pool, date: Date): Promise<void> {
  const deadline = Date.now() + 2500
  while (Date.now() < deadline) {
    const result = await pool.query(
      "SELECT clock_timestamp() AT TIME ZONE 'UTC' >= $1::timestamp AS passed",
      [date.toISOString()]
    )
    if (result.rows[0].passed) return
  }
  throw new Error('Database clock did not reach invitation expiry')
}
