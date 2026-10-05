import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { guardTransactionClient, ShutdownCutoffError } from './notification-guarded-tx'

import type { Prisma } from '@/generated/prisma/client'

/** Returned instead of a result once the latch is sealed; callers stop, never continue. */
export const CUTOFF = Symbol('notification.shutdown.cutoff')
export type Cutoff = typeof CUTOFF

/** The part of `PrismaService` the latch needs to open an interactive transaction. */
export interface TransactionRunner {
  $transaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number }
  ): Promise<T>
}

/**
 * Process-wide shutdown latch for the notification dispatcher (worker role).
 *
 * Two monotonic phases:
 * - `closed`: no new lanes, claims, admissions or reaper entries; work already in flight may
 *   still finish, including recording its result.
 * - `sealed` (the cutoff): nothing new starts — no DB operation, transaction, business query
 *   or transport — and everyone waiting on a pending DB/transport promise is released.
 *   Sealing is idempotent and is reached before every return of the shutdown barrier.
 *
 * A pending promise is never cancelled; it is only no longer *waited for*. Late settlement is
 * always consumed (never an unhandled rejection) and is inert once sealed. An issued
 * transaction ends atomically in exactly one of: commit (its callback finished all queries) or
 * rollback (a guarded query was attempted after the seal).
 */
@Injectable()
export class NotificationShutdownLatch {
  private closedFlag = false
  private sealedFlag = false
  private outstanding = 0
  private readonly waiters = new Set<() => void>()
  private readonly attempts = new Set<AbortController>()

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(NotificationShutdownLatch.name)
  }

  get closed(): boolean {
    return this.closedFlag
  }

  get sealed(): boolean {
    return this.sealedFlag
  }

  /** Pending (issued, not yet settled) guarded operations — observability/tests only. */
  get outstandingCount(): number {
    return this.outstanding
  }

  /** Stop admitting new work. Idempotent. */
  close(): void {
    this.closedFlag = true
  }

  /** Reach the cutoff: abort attempts, release waiters. Monotonic and idempotent. */
  seal(): void {
    if (this.sealedFlag) return
    this.closedFlag = true
    this.sealedFlag = true
    for (const controller of this.attempts) controller.abort()
    this.attempts.clear()
    const released = [...this.waiters]
    this.waiters.clear()
    for (const release of released) release()
  }

  /**
   * One abort controller per delivery attempt; aborted by the attempt's own timeout or by the
   * seal. A controller requested after the seal is already aborted.
   */
  openAttempt(): { signal: AbortSignal; abort: () => void; dispose: () => void } {
    const controller = new AbortController()
    if (this.sealedFlag) {
      controller.abort()
    } else {
      this.attempts.add(controller)
    }
    return {
      signal: controller.signal,
      abort: () => controller.abort(),
      dispose: () => {
        this.attempts.delete(controller)
      },
    }
  }

  /**
   * Run one non-interactive operation. Sealed → the operation is NOT invoked and `CUTOFF` is
   * returned. Otherwise it is invoked and raced against the seal; a later settlement is consumed.
   */
  run<T>(operation: () => Promise<T>): Promise<T | Cutoff> {
    if (this.sealedFlag) return Promise.resolve(CUTOFF)
    let pending: Promise<T>
    try {
      pending = operation()
    } catch (error) {
      return Promise.reject(error)
    }
    return this.raceSeal(pending)
  }

  /**
   * Run an interactive transaction whose callback receives a GUARDED client: a seal inside the
   * callback makes the next query throw `ShutdownCutoffError`, the callback rejects, and Prisma
   * rolls the whole transaction back — a seal is never turned into a successful partial return.
   * The error is consumed only here, outside the transaction, and mapped to `CUTOFF`.
   */
  async transaction<T>(
    runner: TransactionRunner,
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number }
  ): Promise<T | Cutoff> {
    if (this.sealedFlag) return CUTOFF
    const pending = runner.$transaction(
      (raw) => callback(guardTransactionClient(raw, () => this.sealedFlag)),
      options
    )
    try {
      return await this.raceSeal(pending)
    } catch (error) {
      if (error instanceof ShutdownCutoffError) return CUTOFF
      throw error
    }
  }

  /**
   * Race a promise against the seal without accumulating reactions on a shared promise (a
   * long-lived `Promise.race` would leak one reaction per call): waiters are removed on settle.
   */
  private raceSeal<T>(pending: Promise<T>): Promise<T | Cutoff> {
    this.outstanding += 1
    return new Promise<T | Cutoff>((resolve, reject) => {
      let released = false
      const waiter = (): void => {
        released = true
        resolve(CUTOFF)
      }
      this.waiters.add(waiter)
      pending.then(
        (value) => {
          this.outstanding -= 1
          this.waiters.delete(waiter)
          if (!released) resolve(value)
        },
        (error: unknown) => {
          this.outstanding -= 1
          this.waiters.delete(waiter)
          if (released) {
            // Settled after the seal: nobody awaits it any more. Consumed here, bounded fields
            // only; the expected rollback of a sealed transaction is not worth a warning.
            if (!(error instanceof ShutdownCutoffError)) {
              this.logger.warn(
                { event: 'notification.shutdown.late_rejection' },
                'Notification operation rejected after the shutdown seal'
              )
            }
            return
          }
          reject(error)
        }
      )
    })
  }
}
