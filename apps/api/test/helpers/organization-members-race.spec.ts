import type { PrismaService } from '../../src/prisma'

import { deferred, holdMemberTransaction } from './organization-members-race'

const jest = import.meta.jest

function transactionFixture() {
  const queryCompleted = deferred()
  const query = jest.fn(async () => {
    queryCompleted.resolve()
    return [{ id: 'owned-org' }]
  })
  const transaction = jest.fn(async (work: unknown, _options?: { timeout?: number }) =>
    typeof work === 'function'
      ? work({ $queryRaw: query })
      : Promise.all(work as Promise<unknown>[])
  )
  const prisma = {
    $transaction: (work: unknown, options?: { timeout?: number }) => transaction(work, options),
  } as unknown as PrismaService
  const target = () =>
    prisma.$transaction((tx) => tx.$queryRaw`SELECT id FROM core.organizations FOR UPDATE`)
  return { prisma, transaction, queryCompleted, target }
}

describe('Member race helper routing without database dependencies', () => {
  it('an unrelated callback cannot consume the fence; work and options pass through', async () => {
    const { prisma, transaction, target } = transactionFixture()
    const hold = holdMemberTransaction(prisma, false)
    let pending: Promise<unknown> | undefined
    try {
      const options = { timeout: 1234 }
      const unrelated = prisma.$transaction((tx) => tx.$queryRaw`SELECT 1`, options)
      expect(
        await Promise.race([
          unrelated.then(() => 'completed'),
          hold.entered.then(() => 'wrongly-held'),
        ])
      ).toBe('completed')
      await expect(unrelated).resolves.toEqual([{ id: 'owned-org' }])
      expect(transaction).toHaveBeenLastCalledWith(expect.any(Function), options)
      pending = target()
      expect(
        await Promise.race([hold.entered.then(() => 'held'), pending.then(() => 'escaped')])
      ).toBe('held')
      hold.release()
      await expect(pending).resolves.toEqual([{ id: 'owned-org' }])
    } finally {
      hold.restore()
      if (pending) await pending
    }
  })

  it('passes batch transactions through without consuming the callback fence', async () => {
    const { prisma, transaction, target } = transactionFixture()
    const hold = holdMemberTransaction(prisma, false)
    let pending: Promise<unknown> | undefined
    try {
      const batch = [Promise.resolve({ id: 'batch-result' })]
      await expect(prisma.$transaction(batch as never)).resolves.toEqual([{ id: 'batch-result' }])
      expect(transaction).toHaveBeenLastCalledWith(batch, undefined)
      pending = target()
      expect(
        await Promise.race([hold.entered.then(() => 'held'), pending.then(() => 'escaped')])
      ).toBe('held')
      hold.release()
      await pending
    } finally {
      hold.restore()
      if (pending) await pending
    }
  })

  it('holds only after the query finishes; restore releases work and restores the method', async () => {
    const { prisma, queryCompleted, target } = transactionFixture()
    const original = prisma.$transaction
    const hold = holdMemberTransaction(prisma, false)
    const pending = target()
    let settled = false
    void pending.then(() => {
      settled = true
    })
    try {
      await queryCompleted.promise
      await hold.entered
      expect(settled).toBe(false)
      hold.restore()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(settled).toBe(true)
      expect(prisma.$transaction).toBe(original)
      await expect(prisma.$transaction((tx) => tx.$queryRaw`SELECT 1`)).resolves.toEqual([
        { id: 'owned-org' },
      ])
    } finally {
      hold.release()
      hold.restore()
      await pending
    }
  })
})
