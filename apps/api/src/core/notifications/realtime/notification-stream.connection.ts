import type { NotificationSseEvent } from '@amcore/shared'

/** Why a stream closed — drives the hub's gauge/metric bookkeeping. */
export type StreamCloseReason = 'client' | 'expired' | 'shutdown' | 'overflow'

/**
 * The subset of an Express/Node response the SSE writer needs. Kept minimal so the
 * connection is unit-testable with a fake — no HTTP server required.
 */
export interface StreamWritable {
  write(chunk: string): boolean
  end(): void
  destroy(): void
  once(event: 'drain', listener: () => void): unknown
  removeListener(event: 'drain', listener: () => void): unknown
}

export interface StreamConnectionOptions {
  /** Max data frames buffered while backpressured before the slow consumer is cut. */
  queueDepth: number
  /** Bounded stream lifetime (already clamped); the stream closes when it elapses. */
  lifetimeMs: number
  /** Called exactly once when the stream closes, for hub bookkeeping. */
  onClose: (reason: StreamCloseReason) => void
}

/**
 * One server-side SSE stream (ADR-053). Owns the write path and its backpressure:
 * data frames are written directly while the socket drains and buffered (bounded by
 * `queueDepth`) while it does not; overflowing the buffer **destroys** the socket
 * (graceful `end()` could block behind the same stuck socket) so the client
 * reconnects and resyncs. Heartbeats are *skipped* while backpressured, never queued.
 * `close()` is idempotent and fires `onClose` once.
 */
export class NotificationStreamConnection {
  private queue: string[] = []
  private backpressured = false
  private closed = false
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly res: StreamWritable,
    readonly userId: string,
    private readonly opts: StreamConnectionOptions
  ) {}

  /** Write the initial `ready` comment and arm the lifetime timer. */
  open(): void {
    if (this.closed) return
    this.writeFrame(': ready\n\n')
    this.timer = setTimeout(() => this.close('expired'), this.opts.lifetimeMs)
    // The HTTP socket keeps the process alive; the safety-close timer must not.
    this.timer.unref?.()
  }

  /** Send a disposable hint as an SSE `data:` frame (no `id:`/`event:`; ADR-053). */
  sendData(event: NotificationSseEvent): void {
    if (this.closed) return
    const frame = `data: ${JSON.stringify(event)}\n\n`
    if (this.backpressured) {
      if (this.queue.length >= this.opts.queueDepth) return this.overflow()
      this.queue.push(frame)
      return
    }
    this.writeFrame(frame)
  }

  /** Periodic keepalive comment — dropped (never queued) while backpressured. */
  heartbeat(): void {
    if (this.closed || this.backpressured) return
    this.writeFrame(': hb\n\n')
  }

  close(reason: StreamCloseReason): void {
    if (this.closed) return
    this.closed = true
    this.clearTimer()
    this.res.removeListener('drain', this.onDrain)
    try {
      this.res.end()
    } catch {
      /* peer may have already torn the socket down */
    }
    this.opts.onClose(reason)
  }

  private writeFrame(frame: string): void {
    if (!this.res.write(frame)) {
      this.backpressured = true
      this.res.once('drain', this.onDrain)
    }
  }

  private readonly onDrain = (): void => {
    if (this.closed) return
    this.backpressured = false
    while (!this.backpressured && this.queue.length > 0) {
      this.writeFrame(this.queue.shift() as string)
    }
  }

  private overflow(): void {
    if (this.closed) return
    this.closed = true
    this.clearTimer()
    this.res.removeListener('drain', this.onDrain)
    this.res.destroy()
    this.opts.onClose('overflow')
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }
}
