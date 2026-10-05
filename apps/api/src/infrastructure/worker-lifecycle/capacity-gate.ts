import type { ShutdownLatch } from './shutdown-latch'

/**
 * Process-wide capacity gate for one durable worker subsystem (synchronous, no I/O). Every dispatch
 * entry — BullMQ wake, recovery cron — reserves lanes here BEFORE any awaited work, so two
 * overlapping drains can never exceed the cap by both sampling "free" capacity first. It is a
 * per-process limit, not a fleet quota or rate limit.
 *
 * A reservation covers a physical provider/tool call: it is released only when that call has
 * actually settled, never merely when a timeout wrapper resolved. Created by a factory (not
 * injectable) so tests can choose the capacity.
 */
export class CapacityGate {
  private inUse = 0
  private rescanRequested = false

  constructor(
    private readonly latch: ShutdownLatch,
    readonly capacity: number
  ) {}

  /** Atomically reserve up to `max` slots; 0 once the dispatcher is closed or the gate is full. */
  reserve(max: number): number {
    if (this.latch.closed) return 0
    const granted = Math.max(0, Math.min(max, this.capacity - this.inUse))
    this.inUse += granted
    return granted
  }

  release(count = 1): void {
    this.inUse = Math.max(0, this.inUse - count)
  }

  get free(): number {
    return this.capacity - this.inUse
  }

  /** A drain found the gate full: a running lane should look once more before it exits. */
  requestRescan(): void {
    this.rescanRequested = true
  }

  consumeRescan(): boolean {
    const requested = this.rescanRequested
    this.rescanRequested = false
    return requested
  }
}
