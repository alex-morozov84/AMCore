import type {
  RequestPrincipal,
  WorkCommand,
  WorkJob,
  WorkListQuery,
  WorkPage,
  WorkReason,
  WorkSummary,
} from '@amcore/shared'

import type { ControlTransaction } from './control-transaction'

export interface ControlSnapshot {
  readonly id: string
  readonly incarnation?: string
  readonly queueEpoch?: string
  readonly snapshot: Readonly<Record<string, string | number | boolean | null>>
}

/** Business-owned authority: generic ADMIN invokes these ports inside its existing strict transaction. */
export interface DurableWorkReader {
  readSummary(): Promise<WorkSummary>
  list(query: WorkListQuery): Promise<WorkPage>
  detail(id: string): Promise<WorkJob | null>
}

export type DurableOutcome =
  { readonly state: 'applied' } | { readonly state: 'rejected'; readonly reason: WorkReason }

export interface DurableControlState {
  readonly targets: readonly ControlSnapshot[]
  readonly businessState: unknown
}

export interface DurableTransactionContext extends ControlTransaction {
  readonly principal: RequestPrincipal
  readonly commandId: string
  readonly dispatchId: string
  readonly dispatchNotAfter: Date
}

export interface DurableWorkControl {
  /** Lock business authority after generic quota locks; return bounded snapshots under that lock. */
  lock(ctx: DurableTransactionContext, command: WorkCommand): Promise<DurableControlState>
  eligibility(
    ctx: DurableTransactionContext,
    state: DurableControlState,
    command: WorkCommand
  ): WorkReason | null
  /** Business writes, ADMIN applied receipt and strict audit commit/rollback together in caller tx. */
  apply(
    ctx: DurableTransactionContext,
    state: DurableControlState,
    command: WorkCommand
  ): Promise<ReadonlyMap<string, DurableOutcome>>
}
