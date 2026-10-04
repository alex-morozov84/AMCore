import { AsyncLocalStorage } from 'node:async_hooks'

import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

import type { Prisma } from '../../src/generated/prisma/client'
import type { PrismaService } from '../../src/prisma'
const jest = import.meta.jest

const operations = new AsyncLocalStorage<{ capture: (pid: number) => void }>()
const backends = new WeakMap<Promise<unknown>, Promise<number>>()

/** Bind the exact invoked service operation to its real transaction connection. */
export function trackInvitationOperation<T>(work: () => Promise<T>): Promise<T> {
  let capture!: (pid: number) => void
  const pid = new Promise<number>((resolve) => {
    capture = resolve
  })
  const result = operations.run({ capture }, work)
  backends.set(result, pid)
  return result
}

export function carryInvitationBackend<T>(
  source: Promise<unknown>,
  result: Promise<T>
): Promise<T> {
  const pid = backends.get(source)
  if (pid) backends.set(result, pid)
  return result
}

export async function invitationBackend(operation: Promise<unknown>): Promise<number> {
  const pid = backends.get(operation)
  if (!pid) throw new Error('Waiter operation was not tracked')
  return Promise.race([
    pid,
    operation.then(() => {
      throw new Error('Waiter finished before capture')
    }),
    boundedFailure('Waiter backend capture'),
  ])
}

export function boundedFailure(label: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded 1500ms`)), 1500)
    timer.unref()
  })
}

export function observeInvitationTransactions(prisma: PrismaService): () => void {
  const original = prisma.$transaction.bind(prisma)
  const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: object
  ) => {
    const operation = operations.getStore()
    if (!operation || typeof work !== 'function') return original(work, options)
    return original(async (tx) => {
      const rows = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      operation.capture(rows[0]!.pid)
      return work(tx)
    }, options)
  }) as never)
  return () => spy.mockRestore()
}

export function invitationClientQuery(
  client: PoolClient,
  sql: string,
  values: unknown[]
): Promise<QueryResult<QueryResultRow>> {
  const pid = client.query('SELECT pg_backend_pid() AS pid').then((r) => r.rows[0].pid as number)
  const result = pid.then(() => client.query(sql, values))
  backends.set(result, pid)
  return result
}

export function invitationPoolQuery(
  pool: Pool,
  sql: string,
  values: unknown[]
): Promise<QueryResult<QueryResultRow>> {
  let capture!: (pid: number) => void
  const pid = new Promise<number>((resolve) => {
    capture = resolve
  })
  const result = (async () => {
    const client = await pool.connect()
    try {
      capture((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid)
      await client.query("SET statement_timeout = '3s'")
      return await client.query(sql, values)
    } finally {
      await client.query('RESET statement_timeout')
      client.release()
    }
  })()
  backends.set(result, pid)
  return result
}
