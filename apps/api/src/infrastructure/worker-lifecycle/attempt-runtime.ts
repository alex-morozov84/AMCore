/**
 * Per-attempt bookkeeping for one delivery attempt: its abort controller and whether the single
 * physical transport call has SETTLED. A capacity slot is tied to settlement, not to the attempt
 * timeout — a timed-out call whose transport ignores abort keeps its slot until it really ends.
 */
export class AttemptRuntime {
  private settledFlag = false
  private transportSettled: Promise<void> | null = null

  constructor(readonly attempt: { signal: AbortSignal; abort: () => void; dispose: () => void }) {}

  /** Track the transport promise; both resolve and reject count as settled and are consumed. */
  onTransportStarted(transport: Promise<unknown>): void {
    this.transportSettled = transport.then(
      () => {
        this.settledFlag = true
      },
      () => {
        this.settledFlag = true
      }
    )
  }

  /** True while a transport call was started and has not settled yet. */
  get transportPending(): boolean {
    return this.transportSettled !== null && !this.settledFlag
  }

  /** Resolves (never rejects) once the transport call has settled; immediately if none started. */
  whenSettled(): Promise<void> {
    return this.transportSettled ?? Promise.resolve()
  }
}
