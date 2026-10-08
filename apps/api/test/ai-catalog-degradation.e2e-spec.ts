import { jest } from '@jest/globals'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool, type PoolClient } from 'pg'

import { AiCatalogLoad } from '../src/infrastructure/ai/registry/ai-catalog-load'
import { ObservedTransactionRunner } from '../src/prisma/observed-transaction'

import { catalogueRedisPhysicalProof } from './fixtures/ai-catalog-redis-proof'
import { observedPrismaRoleProof } from './fixtures/observed-prisma-role-proof'

function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

/** Real Prisma manager: maxWait can settle before adapter startup and discard cleanup. */
describe('AI catalogue physical PG lifetime', () => {
  let container: StartedPostgreSqlContainer
  const pools: Pool[] = []
  const runners: ObservedTransactionRunner[] = []
  const gates: ReturnType<typeof barrier>[] = []

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine').start()
  }, 120000)
  afterEach(async () => {
    for (const gate of gates.splice(0)) gate.release()
    for (const runner of runners.splice(0)) await runner.disconnect()
    for (const pool of pools.splice(0)) await pool.end()
  })
  afterAll(async () => {
    await container?.stop()
  })

  observedPrismaRoleProof(() => container.getConnectionUri())

  function fixture() {
    const pool = new Pool({ connectionString: container.getConnectionUri(), max: 2 })
    pools.push(pool)
    const acquire = barrier()
    const rollback = barrier()
    const released = barrier()
    gates.push(acquire, rollback, released)
    const original = pool.connect.bind(pool)
    let starts = 0
    let cleanups = 0
    pool.connect = (async () => {
      starts++
      await acquire.promise
      const client = await original()
      const query = client.query.bind(client)
      client.query = (async (config: { text: string }) => {
        if (config.text === 'ROLLBACK') await rollback.promise
        return query(config)
      }) as PoolClient['query']
      const release = client.release.bind(client)
      client.release = (...args) => {
        release(...args)
        cleanups++
        released.release()
      }
      return client
    }) as Pool['connect']
    const runner = new ObservedTransactionRunner(pool)
    runners.push(runner)
    return { runner, acquire, rollback, released, starts: () => starts, cleanups: () => cleanups }
  }

  it.each(['startup', 'commit', 'rollback', 'release'] as const)(
    'real manager %s failure quarantines only its private capability',
    async (failure) => {
      const pool = new Pool({ connectionString: container.getConnectionUri(), max: 2 })
      pools.push(pool)
      const connect = pool.connect.bind(pool)
      let acquired = 0
      const quarantine = jest.fn()
      pool.connect = (async () => {
        acquired++
        if (failure === 'startup') throw new Error('fixture startup failure')
        const client = await connect()
        const query = client.query.bind(client)
        client.query = (async (config: { text: string }) => {
          if (config.text === failure.toUpperCase()) throw new Error('fixture cleanup SQL failure')
          return query(config)
        }) as PoolClient['query']
        const release = client.release.bind(client)
        client.release = (...args) => {
          release(...args)
          if (failure === 'release') throw new Error('fixture release failure')
        }
        return client
      }) as Pool['connect']
      const runner = new ObservedTransactionRunner(pool, quarantine)
      runners.push(runner)
      let physical = false
      const operation = runner.start(async (tx) => {
        await tx.$queryRaw`SELECT 1`
        if (failure === 'rollback') throw new Error('fixture application rollback')
        return 'ok'
      })
      void operation.physicalCompletion.then(() => {
        physical = true
      })
      await expect(operation.result).rejects.toThrow()
      expect(quarantine).toHaveBeenCalledTimes(1)
      expect(physical).toBe(false)
      for (let i = 0; i < 3; i++)
        expect(() => runner.start(async () => 'denied')).toThrow('observed_transaction_unavailable')
      expect(acquired).toBe(1)
      runner.close()
      expect(() => runner.start(async () => 'denied')).toThrow('observed_transaction_unavailable')
      // Existing pool and independent main-client traffic remain usable. This is NOT a token reset.
      expect(
        (
          await connect().then(async (client) => {
            try {
              return await client.query('SELECT 1 AS ok')
            } finally {
              client.release(true)
            }
          })
        ).rows
      ).toEqual([{ ok: 1 }])
    }
  )

  it('normal callback failure releases only after real rollback, then close rejects new starts', async () => {
    const f = fixture()
    f.acquire.release()
    const operation = f.runner.start(async (tx) => {
      await tx.$queryRaw`SELECT 1`
      throw new Error('callback rollback')
    })
    const rejection = operation.result.then(
      () => {
        throw new Error('expected callback rollback')
      },
      (error: Error) => {
        expect(error.message).toContain('callback rollback')
      }
    )
    expect(f.cleanups()).toBe(0)
    f.rollback.release()
    await rejection
    await operation.physicalCompletion
    expect(f.cleanups()).toBe(1)
    f.runner.close()
    expect(() => f.runner.start(async () => undefined)).toThrow('observed_transaction_unavailable')
  })

  it('keeps one physical startup past maxWait and cooldown until late rollback/release', async () => {
    const f = fixture()
    let clock = 0
    const selects = jest.fn()
    let completed!: Promise<void>
    const load = new AiCatalogLoad(
      () => {
        const operation = f.runner.start(async (tx) => {
          selects()
          await tx.$queryRaw`SELECT 1`
          return ['ok']
        })
        completed = operation.physicalCompletion
        return operation
      },
      () => clock
    )
    const first = load.load()
    await expect(first).rejects.toThrow()
    expect(f.starts()).toBe(1)
    for (const tick of [1001, 2002, 3003]) {
      clock = tick
      const controller = new AbortController()
      const waiter = load.load(controller.signal)
      controller.abort()
      await expect(waiter).rejects.toBeDefined()
      expect(f.starts()).toBe(1)
      expect(() => f.runner.start(async () => undefined)).toThrow(
        'observed_transaction_unavailable'
      )
    }
    f.acquire.release()
    expect(f.cleanups()).toBe(0)
    f.rollback.release()
    await f.released.promise
    await completed
    expect(selects).not.toHaveBeenCalled() // Prisma never admitted the late application callback.
    expect(f.cleanups()).toBe(1)
    // Wait through the observed physical event, not through an arbitrary elapsed timeout.
    const next = f.runner.start(async (tx) => {
      await tx.$queryRaw`SELECT 1`
      return 'next'
    })
    expect(await next.result).toBe('next')
    await next.physicalCompletion
  }, 15000)

  it('all detached waiters start no SELECT when admitted startup eventually completes', async () => {
    const f = fixture()
    const controller = new AbortController()
    const select = jest.fn()
    const load = new AiCatalogLoad((canQuery) =>
      f.runner.start(async (tx) => {
        canQuery()
        select()
        await tx.$queryRaw`SELECT 1`
        return 'ok'
      })
    )
    const waiter = load.load(controller.signal)
    controller.abort()
    await expect(waiter).rejects.toBeDefined()
    f.acquire.release()
    f.rollback.release()
    await f.released.promise
    expect(select).not.toHaveBeenCalled()
  })
})

catalogueRedisPhysicalProof()
