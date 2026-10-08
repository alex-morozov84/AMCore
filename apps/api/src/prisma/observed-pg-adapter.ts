import type { PrismaPg } from '@prisma/adapter-pg'

type Adapter = Awaited<ReturnType<PrismaPg['connect']>>
type Transaction = Awaited<ReturnType<Adapter['startTransaction']>>
type Query = Parameters<Transaction['executeRaw']>[0]

/** One token spans acquisition, BEGIN, application queries and engine-owned release. */
export class PhysicalTransaction {
  issued = false
  logicalSettled = false
  released = false
  quarantined = false
  readonly completed: Promise<void>
  private finish!: () => void

  constructor(private readonly onQuarantine: () => void = () => undefined) {
    this.completed = new Promise((resolve) => {
      this.finish = resolve
    })
  }

  settleLogical(): void {
    this.logicalSettled = true
    // Before startTransaction there was no pool acquisition to abandon.
    if (!this.issued) this.released = true
    this.maybeFinish()
  }

  release(): void {
    this.released = true
    this.maybeFinish()
  }

  quarantine(): void {
    if (this.quarantined) return
    this.quarantined = true
    this.onQuarantine()
  }

  private maybeFinish(): void {
    if (this.logicalSettled && this.released && !this.quarantined) this.finish()
  }
}

/** Public driver-adapter boundary; Prisma's maxWait Promise cannot observe late discard cleanup. */
export class ObservedPgAdapter {
  readonly provider = 'postgres' as const
  readonly adapterName: string
  token: PhysicalTransaction | undefined

  constructor(private readonly delegate: PrismaPg) {
    this.adapterName = delegate.adapterName
  }

  async connect(): Promise<Adapter> {
    const adapter = await this.delegate.connect()
    return {
      provider: adapter.provider,
      adapterName: adapter.adapterName,
      queryRaw: adapter.queryRaw.bind(adapter),
      executeRaw: adapter.executeRaw.bind(adapter),
      executeScript: adapter.executeScript.bind(adapter),
      getConnectionInfo: adapter.getConnectionInfo.bind(adapter),
      dispose: adapter.dispose.bind(adapter),
      underlyingDriver: adapter.underlyingDriver.bind(adapter),
      startTransaction: (level) => this.start(adapter, level),
    } as Adapter
  }

  private async start(
    adapter: Adapter,
    level: Parameters<Adapter['startTransaction']>[0]
  ): Promise<Transaction> {
    const token = this.token
    if (!token || token.issued) throw new Error('observed_transaction_start_denied')
    token.issued = true
    try {
      return observeRelease(await adapter.startTransaction(level), token)
    } catch (error) {
      // The supported API gives no physical-acquisition disposition on startup failure.
      token.quarantine()
      throw error
    }
  }
}

function observeRelease(tx: Transaction, token: PhysicalTransaction): Transaction {
  let terminalAcknowledged = false
  const executeRaw = async (query: Query): Promise<number> => {
    const terminal = /^(COMMIT|ROLLBACK)\s*;?$/i.test(query.sql.trim())
    try {
      const result = await tx.executeRaw(query)
      if (terminal) terminalAcknowledged = true
      return result
    } catch (error) {
      if (terminal) token.quarantine()
      throw error
    }
  }
  const cleanup = async (method: 'commit' | 'rollback'): Promise<void> => {
    try {
      await tx[method]()
      if (terminalAcknowledged) token.release()
      else token.quarantine()
    } catch (error) {
      token.quarantine()
      throw error
    }
  }
  return {
    provider: tx.provider,
    adapterName: tx.adapterName,
    options: tx.options,
    queryRaw: tx.queryRaw.bind(tx),
    executeRaw,
    commit: () => cleanup('commit'),
    rollback: () => cleanup('rollback'),
  }
}
