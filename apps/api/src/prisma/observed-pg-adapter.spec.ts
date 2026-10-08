import type { PrismaPg } from '@prisma/adapter-pg'

import { ObservedPgAdapter, PhysicalTransaction } from './observed-pg-adapter'

function fixture() {
  const tx = {
    provider: 'postgres',
    adapterName: 'fixture',
    options: { usePhantomQuery: false },
    queryRaw: jest.fn(),
    executeRaw: jest.fn().mockResolvedValue(0),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  }
  const raw = {
    provider: 'postgres',
    adapterName: 'fixture',
    queryRaw: jest.fn(),
    executeRaw: jest.fn(),
    executeScript: jest.fn(),
    getConnectionInfo: jest.fn(),
    dispose: jest.fn(),
    underlyingDriver: jest.fn(),
    startTransaction: jest.fn().mockResolvedValue(tx),
  }
  const adapter = new ObservedPgAdapter({
    adapterName: 'fixture',
    connect: async () => raw,
  } as unknown as PrismaPg)
  const token = new PhysicalTransaction()
  adapter.token = token
  return { tx, raw, adapter, token }
}

const query = (sql: string) => ({ sql, args: [], argTypes: [] })

describe('adapter-observed physical lifetime', () => {
  it('does not complete on logical timeout or terminal SQL alone; release is required', async () => {
    const { adapter, token, tx } = fixture()
    const observed = await (await adapter.connect()).startTransaction()
    const completed = jest.fn()
    void token.completed.then(completed)
    token.settleLogical()
    await observed.executeRaw(query('ROLLBACK'))
    expect(completed).not.toHaveBeenCalled()
    let release!: () => void
    tx.rollback.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const cleanup = observed.rollback()
    await Promise.resolve()
    expect(completed).not.toHaveBeenCalled()
    release()
    await cleanup
    await token.completed
    expect(completed).toHaveBeenCalledTimes(1)
  })

  it.each(['commit', 'rollback'] as const)(
    'observes normal %s plus logical settlement',
    async (method) => {
      const { adapter, token } = fixture()
      const observed = await (await adapter.connect()).startTransaction()
      await observed.executeRaw(query(method.toUpperCase()))
      await observed[method]()
      expect(token.released).toBe(true)
      expect(token.logicalSettled).toBe(false)
      token.settleLogical()
      await token.completed
    }
  )

  it('quarantines startup failure even when the returned Promise rejects', async () => {
    const { adapter, token, raw } = fixture()
    raw.startTransaction.mockRejectedValueOnce(new Error('startup'))
    await expect((await adapter.connect()).startTransaction()).rejects.toThrow('startup')
    token.settleLogical()
    expect(token.quarantined).toBe(true)
    expect(token.released).toBe(false)
  })

  it.each(['sql', 'release'] as const)('quarantines %s cleanup failure', async (failure) => {
    const { adapter, token, tx } = fixture()
    const observed = await (await adapter.connect()).startTransaction()
    if (failure === 'sql') tx.executeRaw.mockRejectedValueOnce(new Error('cleanup'))
    else tx.rollback.mockRejectedValueOnce(new Error('cleanup'))
    try {
      await observed.executeRaw(query('ROLLBACK'))
    } catch {
      /* manager still releases */
    }
    try {
      await observed.rollback()
    } catch {
      /* quarantine remains sticky */
    }
    token.settleLogical()
    expect(token.quarantined).toBe(true)
  })

  it('denies a second start before a second acquisition', async () => {
    const { adapter, raw } = fixture()
    const connection = await adapter.connect()
    await connection.startTransaction()
    await expect(connection.startTransaction()).rejects.toThrow('observed_transaction_start_denied')
    expect(raw.startTransaction).toHaveBeenCalledTimes(1)
  })
})
