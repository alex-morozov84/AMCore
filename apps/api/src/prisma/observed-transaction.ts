import { PrismaPg } from '@prisma/adapter-pg'
import type { Pool } from 'pg'

import { ObservedPgAdapter, PhysicalTransaction } from './observed-pg-adapter'
import { observedPgPool } from './observed-pg-pool'

import { type Prisma, PrismaClient } from '@/generated/prisma/client'

export interface ObservedTransactionResult<T> {
  result: Promise<T>
  physicalCompletion: Promise<void>
}

/** Private single-transaction client on the existing pool; never expose its unrestricted client. */
export class ObservedTransactionRunner {
  private readonly adapter: ObservedPgAdapter
  private readonly client: PrismaClient
  private active: PhysicalTransaction | undefined
  private closed = false

  constructor(
    pool: Pool,
    private readonly onQuarantine: () => void = () => undefined
  ) {
    this.adapter = new ObservedPgAdapter(new PrismaPg(observedPgPool(pool, () => this.active)))
    this.client = new PrismaClient({ adapter: this.adapter })
  }

  start<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): ObservedTransactionResult<T> {
    if (this.closed || this.active) throw new Error('observed_transaction_unavailable')
    const token = new PhysicalTransaction(this.onQuarantine)
    this.active = token
    this.adapter.token = token
    const result = this.client.$transaction(operation, { maxWait: 250, timeout: 2000 })
    void result.then(
      () => token.settleLogical(),
      () => token.settleLogical()
    )
    void token.completed.then(() => {
      if (this.active === token) {
        this.active = undefined
        this.adapter.token = undefined
      }
    })
    return { result, physicalCompletion: token.completed }
  }

  /** ShutdownLatch supplies a query-guarded callback; this facade still owns physical completion. */
  $transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.start(operation).result
  }

  close(): void {
    this.closed = true
  }

  async disconnect(): Promise<void> {
    this.close()
    // Disconnect is cleanup, never a signal that an occupied physical slot can be reused.
    await this.client.$disconnect()
  }
}
