import type { Pool, PoolClient, QueryResult } from 'pg'

import type { PrismaService } from '../src/prisma'

import { deferredGate } from './org-acl-freshness.fixture'

/** Observe and pause the real adapter connection; no production query hook. */
export function snapshotBarrier(prisma: PrismaService): ReturnType<typeof deferredGate> & {
  sql: string[]
  getIsolation: () => string
  restore: () => void
} {
  const pool = (prisma as unknown as { pool: Pool }).pool
  const connect = pool.connect.bind(pool)
  const restoreClients: (() => void)[] = []
  const gate = deferredGate()
  const sql: string[] = []
  let armed = true
  let isolation = ''
  pool.connect = ((...args: unknown[]) => {
    // Pool.query uses callback connect; only adapter promise connect is wrapped.
    if (args.length) return Reflect.apply(connect, pool, args)
    return (async () => {
      const client = await connect()
      const query = client.query.bind(client)
      const statements: string[] = []
      let reader = false
      const wrapped = async (...args: unknown[]): Promise<QueryResult> => {
        const config = args[0] as string | { text: string }
        const text = typeof config === 'string' ? config : config.text
        const result = (await Reflect.apply(query, client, args)) as QueryResult
        statements.push(text)
        if (armed && /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/i.test(text)) {
          armed = false
          reader = true
          const show = await query('SHOW transaction_isolation')
          isolation = show.rows[0].transaction_isolation as string
          await query('SELECT 1')
          sql.push(...statements, 'SHOW transaction_isolation', 'SELECT 1')
          await gate.pause()
        } else if (reader) {
          sql.push(text)
        }
        return result
      }
      client.query = wrapped as PoolClient['query']
      restoreClients.push(() => {
        client.query = query
      })
      return client
    })()
  }) as Pool['connect']
  return {
    ...gate,
    sql,
    getIsolation: () => isolation,
    restore: () => {
      pool.connect = connect
      for (const restore of restoreClients.reverse()) restore()
    },
  }
}
