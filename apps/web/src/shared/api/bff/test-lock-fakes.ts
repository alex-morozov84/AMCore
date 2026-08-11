import type { VaultLock } from './session-vault.types'

/** Single-holder lock that genuinely queues a second waiter until release. */
export class QueuedFakeLock implements VaultLock {
  private holder: string | null = null
  private waiters: Array<() => void> = []
  private counter = 0

  async acquire(): Promise<string> {
    if (this.holder === null) {
      this.holder = `tok-${++this.counter}`
      return this.holder
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.holder = `tok-${++this.counter}`
    return this.holder
  }

  async renew() {
    return true
  }

  async release(_sessionId: string, token: string) {
    if (this.holder !== token) return
    this.holder = null
    this.waiters.shift()?.()
  }
}

export class SimpleLock implements VaultLock {
  async acquire() {
    return 'tok'
  }
  async renew() {
    return true
  }
  async release() {}
}

export class NeverAcquiresLock implements VaultLock {
  async acquire() {
    return null
  }
  async renew() {
    return false
  }
  async release() {}
}

/** Renew always fails (resolves false) — simulates lost exclusivity mid-refresh. */
export class FailingRenewalLock implements VaultLock {
  async acquire() {
    return 'tok'
  }
  async renew() {
    return false
  }
  async release() {}
}

/** Renew always rejects — simulates a Redis outage/network error during renewal. */
export class RejectingRenewalLock implements VaultLock {
  async acquire() {
    return 'tok'
  }
  async renew(): Promise<boolean> {
    throw new Error('ECONNREFUSED')
  }
  async release() {}
}

/**
 * Models real TTL expiry (via `Date.now()`, so it needs fake timers to
 * control deterministically) rather than just queuing waiters — needed to
 * prove renewal genuinely extends the lease past the original TTL, not just
 * that some in-memory queue eventually lets the next caller through.
 */
export class TtlAwareFakeLock implements VaultLock {
  private holder: { token: string; expiresAt: number } | null = null
  private counter = 0

  private expireIfPast() {
    if (this.holder && this.holder.expiresAt <= Date.now()) this.holder = null
  }

  async acquire(_sessionId: string, ttlMs: number) {
    this.expireIfPast()
    if (this.holder) return null
    const token = `tok-${++this.counter}`
    this.holder = { token, expiresAt: Date.now() + ttlMs }
    return token
  }

  async renew(_sessionId: string, token: string, ttlMs: number) {
    this.expireIfPast()
    if (!this.holder || this.holder.token !== token) return false
    this.holder.expiresAt = Date.now() + ttlMs
    return true
  }

  async release(_sessionId: string, token: string) {
    if (this.holder?.token === token) this.holder = null
  }
}
