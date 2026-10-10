import { Injectable, type OnApplicationShutdown } from '@nestjs/common'

/** Shared startup fence; validation failure never releases claims or recovery. */
@Injectable()
export class WorkReadiness implements OnApplicationShutdown {
  private ready = false
  private readonly shutdown = new AbortController()

  get signal(): AbortSignal {
    return this.shutdown.signal
  }

  get isReady(): boolean {
    return this.ready
  }

  open(): void {
    if (this.shutdown.signal.aborted) throw new Error('Background work startup was closed')
    this.ready = true
  }

  close(): void {
    this.ready = false
    this.shutdown.abort()
  }

  onApplicationShutdown(): void {
    this.close()
  }

  assertReady(): void {
    if (!this.ready) throw new Error('Background work is not ready')
  }
}
