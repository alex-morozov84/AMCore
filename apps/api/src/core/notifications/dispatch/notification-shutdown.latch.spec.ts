import { mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import { ShutdownCutoffError } from './notification-guarded-tx'
import {
  CUTOFF,
  NotificationShutdownLatch,
  type TransactionRunner,
} from './notification-shutdown.latch'

import type { Prisma } from '@/generated/prisma/client'

/** A lazy "PrismaPromise": the request is only started when `.then` is first called. */
function lazyQuery<T>(onStart: () => void, value: T): PromiseLike<T> {
  return {
    then(onFulfilled, onRejected) {
      onStart()
      return Promise.resolve(value).then(onFulfilled, onRejected)
    },
  }
}

interface FakeTx {
  started: string[]
  marker: string
  notificationDelivery: { updateMany: (arg: unknown) => PromiseLike<{ count: number }> }
  notificationDeliveryAttempt: { updateMany: (arg: unknown) => PromiseLike<{ count: number }> }
  $queryRaw: (...args: unknown[]) => PromiseLike<unknown[]>
}

/**
 * A fake `$transaction` with real commit/rollback semantics: the callback's writes are staged and
 * only "committed" if the callback RESOLVES — exactly Prisma's `_transactionWithCallback` contract.
 */
function fakeRunner() {
  const committed: string[] = []
  const rolledBack: string[][] = []
  const tx: FakeTx = {
    started: [],
    marker: 'owner',
    notificationDelivery: {
      updateMany(this: { marker?: string }, _arg) {
        return lazyQuery(() => tx.started.push('delivery.updateMany'), { count: 1 })
      },
    },
    notificationDeliveryAttempt: {
      updateMany: () => lazyQuery(() => tx.started.push('attempt.updateMany'), { count: 1 }),
    },
    $queryRaw: () => lazyQuery(() => tx.started.push('queryRaw'), [{ id: 'x' }]),
  }
  const runner: TransactionRunner = {
    async $transaction<T>(callback: (client: Prisma.TransactionClient) => Promise<T>) {
      const before = tx.started.length
      try {
        const result = await callback(tx as unknown as Prisma.TransactionClient)
        committed.push(...tx.started.slice(before))
        return result
      } catch (error) {
        rolledBack.push(tx.started.slice(before))
        throw error
      }
    },
  }
  return { runner, tx, committed, rolledBack }
}

describe('NotificationShutdownLatch', () => {
  let latch: NotificationShutdownLatch

  beforeEach(() => {
    latch = new NotificationShutdownLatch(mockDeep<PinoLogger>())
  })

  describe('phases', () => {
    it('close() then seal() are monotonic and idempotent', () => {
      expect(latch.closed).toBe(false)
      expect(latch.sealed).toBe(false)
      latch.close()
      expect(latch.closed).toBe(true)
      expect(latch.sealed).toBe(false)
      latch.seal()
      latch.seal()
      expect(latch.sealed).toBe(true)
      expect(latch.closed).toBe(true)
    })

    it('aborts open attempts at the seal, and a later attempt starts already aborted', () => {
      const first = latch.openAttempt()
      expect(first.signal.aborted).toBe(false)
      latch.seal()
      expect(first.signal.aborted).toBe(true)
      expect(latch.openAttempt().signal.aborted).toBe(true)
    })

    it('a disposed attempt is no longer aborted by the seal', () => {
      const attempt = latch.openAttempt()
      attempt.dispose()
      latch.seal()
      expect(attempt.signal.aborted).toBe(false)
    })
  })

  describe('run()', () => {
    it('returns the operation result before the seal', async () => {
      await expect(latch.run(async () => 7)).resolves.toBe(7)
    })

    it('does NOT invoke the operation once sealed and returns CUTOFF', async () => {
      latch.seal()
      const operation = jest.fn(async () => 1)
      await expect(latch.run(operation)).resolves.toBe(CUTOFF)
      expect(operation).not.toHaveBeenCalled()
    })

    it('releases a waiter at the seal while the operation stays pending; late resolve is inert', async () => {
      let resolve!: (value: number) => void
      const pending = new Promise<number>((res) => {
        resolve = res
      })
      const waited = latch.run(() => pending)
      latch.seal()
      await expect(waited).resolves.toBe(CUTOFF)
      resolve(5) // late settlement: consumed, no effect
      await Promise.resolve()
    })

    it('consumes a late REJECTION after the seal (no unhandled rejection)', async () => {
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)
      try {
        let reject!: (error: unknown) => void
        const pending = new Promise<number>((_res, rej) => {
          reject = rej
        })
        const waited = latch.run(() => pending)
        latch.seal()
        await waited
        reject(new Error('db reset'))
        await new Promise((resolve) => setImmediate(resolve))
        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })

    it('propagates a rejection that happens BEFORE the seal', async () => {
      await expect(latch.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    })

    it('tracks outstanding operations and clears them on settle', async () => {
      let resolve!: () => void
      const waited = latch.run(
        () =>
          new Promise<void>((res) => {
            resolve = res
          })
      )
      expect(latch.outstandingCount).toBe(1)
      resolve()
      await waited
      expect(latch.outstandingCount).toBe(0)
    })
  })

  describe('transaction() — guarded client, rollback instead of a partial commit', () => {
    it('is refused before starting when already sealed', async () => {
      const { runner } = fakeRunner()
      const spy = jest.spyOn(runner, '$transaction')
      latch.seal()
      await expect(latch.transaction(runner, async () => 1)).resolves.toBe(CUTOFF)
      expect(spy).not.toHaveBeenCalled()
    })

    it('commits a callback whose queries all completed, even if sealed afterwards', async () => {
      const { runner, committed } = fakeRunner()
      const result = await latch.transaction(runner, async (tx) => {
        await tx.notificationDelivery.updateMany({} as never)
        await tx.notificationDeliveryAttempt.updateMany({} as never)
        latch.seal() // after the LAST query: protocol commit is still allowed
        return 'done'
      })
      // The transaction itself commits atomically (all queries finished) ...
      expect(committed).toEqual(['delivery.updateMany', 'attempt.updateMany'])
      // ... but the sealed waiter was released: the CALLER only learns CUTOFF — the row's state is
      // "uncertain until settled" (here: committed), never "unchanged".
      expect(result).toBe(CUTOFF)
    })

    it('a seal BETWEEN the delivery write and the attempt close rolls the WHOLE transaction back', async () => {
      const { runner, tx, committed, rolledBack } = fakeRunner()
      const result = await latch.transaction(runner, async (client) => {
        await client.notificationDelivery.updateMany({} as never)
        latch.seal() // cutoff between two dependent writes
        await client.notificationDeliveryAttempt.updateMany({} as never) // must NOT start
        return 'unreachable'
      })

      expect(result).toBe(CUTOFF) // consumed only OUTSIDE the transaction
      expect(committed).toEqual([]) // nothing committed: no terminal delivery with an open attempt
      expect(rolledBack).toEqual([['delivery.updateMany']])
      expect(tx.started).not.toContain('attempt.updateMany') // zero new business queries after seal
    })

    it('propagates the cutoff through a nested helper that does not swallow errors', async () => {
      const { runner, committed } = fakeRunner()
      const nestedHelper = async (client: Prisma.TransactionClient): Promise<void> => {
        await client.$queryRaw`SELECT 1`
        latch.seal()
        await client.notificationDeliveryAttempt.updateMany({} as never)
      }
      await expect(latch.transaction(runner, async (client) => nestedHelper(client))).resolves.toBe(
        CUTOFF
      )
      expect(committed).toEqual([])
    })

    it('never turns the cutoff into a successful return: the callback itself rejects', async () => {
      const { runner } = fakeRunner()
      let callbackError: unknown
      await latch.transaction(runner, async (client) => {
        latch.seal()
        try {
          await client.notificationDelivery.updateMany({} as never)
        } catch (error) {
          callbackError = error
          throw error
        }
      })
      expect(callbackError).toBeInstanceOf(ShutdownCutoffError)
    })

    it('releases the waiter at the seal while the transaction is still pending', async () => {
      let release!: () => void
      const runner: TransactionRunner = {
        $transaction: () =>
          new Promise((res) => {
            release = () => res('late' as never)
          }),
      }
      const waited = latch.transaction(runner, async () => 'x')
      latch.seal()
      await expect(waited).resolves.toBe(CUTOFF)
      release() // the raw transaction settles on its own; consumed
    })

    it('surfaces an ordinary (non-cutoff) failure unchanged', async () => {
      const { runner } = fakeRunner()
      await expect(
        latch.transaction(runner, async () => {
          throw new Error('constraint')
        })
      ).rejects.toThrow('constraint')
    })
  })

  describe('guarded client facade', () => {
    it('starts a LAZY query synchronously inside the guarded call (no first-execution after the seal)', async () => {
      const { runner, tx } = fakeRunner()
      await latch.transaction(runner, async (client) => {
        const captured = client.notificationDelivery.updateMany({} as never)
        // The query was started by the guarded call itself, before anyone awaited it.
        expect(tx.started).toEqual(['delivery.updateMany'])
        latch.seal()
        await captured // already issued → allowed to finish
      })
    })

    it('binds delegate methods to their real owner', async () => {
      const { runner, tx } = fakeRunner()
      let seenThis: unknown
      tx.notificationDelivery.updateMany = function (this: unknown) {
        seenThis = this
        return lazyQuery(() => undefined, { count: 1 })
      }
      await latch.transaction(runner, async (client) => {
        await client.notificationDelivery.updateMany({} as never)
      })
      expect(seenThis).toBe(tx.notificationDelivery)
    })

    it('refuses every raw-query entry point after the seal', async () => {
      const { runner } = fakeRunner()
      for (const method of ['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe']) {
        const sealedLatch = new NotificationShutdownLatch(mockDeep<PinoLogger>())
        const fake = fakeRunner()
        ;(fake.tx as unknown as Record<string, unknown>)[method] = () =>
          lazyQuery(() => undefined, [])
        const outcome = await sealedLatch.transaction(fake.runner, async (client) => {
          sealedLatch.seal()
          await (client as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!('x')
        })
        expect(outcome).toBe(CUTOFF)
      }
      void runner
    })

    it('does not expose internals: unsupported members throw, `then` is undefined', async () => {
      const { runner } = fakeRunner()
      await latch.transaction(runner, async (client) => {
        expect((client as unknown as { then?: unknown }).then).toBeUndefined()
        expect(() => (client as unknown as { _engine: unknown })._engine).toThrow(
          'guarded_tx_unsupported_access'
        )
        expect(() => (client as unknown as { $transaction: unknown }).$transaction).toThrow(
          'guarded_tx_unsupported_access'
        )
      })
    })
  })
})
