import { performance } from 'node:perf_hooks'

import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { z } from 'zod'

import { CONTROL_LIMITS } from './control-limits'

type OutcomeOwner = 'command' | 'provider'
type SafePayload = z.infer<ReturnType<typeof z.json>>
type Finalizer = (payload: SafePayload) => Promise<void>
interface PendingOutcome {
  readonly owner: OutcomeOwner
  readonly payload: SafePayload
  readonly bytes: number
  readonly expiresAt: number
  attempts: number
}

/** Volatile PG-only recovery. Losing this buffer retains durable uncertainty; it never resends work. */
@Injectable()
export class PgOutcomeBuffer implements OnModuleDestroy {
  private readonly finalizers = new Map<OutcomeOwner, Finalizer>()
  private readonly pending = new Map<string, PendingOutcome>()
  private bytes = 0
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private closed = false

  register(owner: OutcomeOwner, finalizer: Finalizer): void {
    if (this.finalizers.has(owner)) throw new Error('DUPLICATE_OUTCOME_FINALIZER')
    this.finalizers.set(owner, finalizer)
  }

  enqueue(owner: OutcomeOwner, id: string, payload: unknown): boolean {
    if (this.closed || !this.finalizers.has(owner) || id.length < 1 || id.length > 256) return false
    const parsed = z.json().safeParse(payload)
    if (!parsed.success) return false
    const serialized = JSON.stringify(parsed.data)
    const key = `${owner}:${id}`
    const bytes = Buffer.byteLength(serialized, 'utf8') + Buffer.byteLength(key, 'utf8') + 64
    // First witnessed outcome wins. A duplicate cannot renew expiry or replace its certainty.
    if (this.pending.has(key)) return true
    if (
      this.pending.size >= CONTROL_LIMITS.outcomeBuffer.entries ||
      this.bytes + bytes > CONTROL_LIMITS.outcomeBuffer.bytes
    )
      return false
    this.pending.set(key, {
      owner,
      payload: JSON.parse(serialized) as SafePayload,
      bytes,
      expiresAt: performance.now() + CONTROL_LIMITS.outcomeBuffer.ttlMs,
      attempts: 0,
    })
    this.bytes += bytes
    this.schedule()
    return true
  }

  async retryPending(): Promise<void> {
    if (this.closed || this.running) return
    this.running = true
    try {
      const entries = [...this.pending.entries()].slice(0, CONTROL_LIMITS.concurrentDispatches)
      await Promise.all(
        entries.map(async ([key, entry]) => {
          if (
            performance.now() >= entry.expiresAt ||
            entry.attempts >= CONTROL_LIMITS.outcomeBuffer.attempts
          ) {
            this.remove(key, entry)
            return
          }
          entry.attempts += 1
          try {
            // Registered owners enforce bounded PG transactions and strict CAS/audit.
            await this.finalizers.get(entry.owner)!(structuredClone(entry.payload))
            this.remove(key, entry)
          } catch {
            if (entry.attempts >= CONTROL_LIMITS.outcomeBuffer.attempts) this.remove(key, entry)
          }
        })
      )
    } finally {
      this.running = false
      this.schedule()
    }
  }

  onModuleDestroy(): void {
    this.closed = true
    clearTimeout(this.timer)
    this.pending.clear()
    this.bytes = 0
  }

  private remove(key: string, entry: PendingOutcome): void {
    if (this.pending.delete(key)) this.bytes -= entry.bytes
  }

  private schedule(): void {
    if (this.closed || this.timer || this.pending.size === 0) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.retryPending()
    }, 1000)
    this.timer.unref()
  }
}
