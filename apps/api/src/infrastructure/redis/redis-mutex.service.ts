import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { RedisLockService } from './redis-lock.service'

export interface MutexOptions {
  /** Lease length in ms. */
  ttlMs: number
  /** Background renewal interval in ms (must be < ttlMs). */
  renewMs: number
  /** Max acquisition attempts (forwarded to the lock). */
  attempts?: number
  /** Base retry delay in ms (forwarded to the lock). */
  retryDelayMs?: number
}

/**
 * Thrown when the lock cannot be taken — either it stayed held across every
 * attempt, or Redis itself was unreachable. Either way the caller should fail
 * closed and surface a retriable error rather than run unserialized.
 */
export class LockUnavailableError extends Error {
  constructor(key: string, cause?: unknown) {
    super(`Could not acquire lock for "${key}"`, { cause })
    this.name = 'LockUnavailableError'
  }
}

@Injectable()
export class RedisMutexService {
  constructor(
    private readonly lock: RedisLockService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(RedisMutexService.name)
  }

  /**
   * Run `fn` while holding a per-key lock renewed in the background. This
   * serializes the common case and reduces duplicate work; it is best-effort,
   * not a correctness fence (a paused holder can lose its lease — the caller
   * must guard the protected resource itself). Fails closed: any acquisition
   * failure, including a Redis outage, raises `LockUnavailableError`.
   */
  async runExclusive<T>(key: string, options: MutexOptions, fn: () => Promise<T>): Promise<T> {
    let token: string | null
    try {
      token = await this.lock.acquireBlocking(key, options.ttlMs, {
        attempts: options.attempts,
        retryDelayMs: options.retryDelayMs,
      })
    } catch (err) {
      throw new LockUnavailableError(key, err)
    }
    if (!token) throw new LockUnavailableError(key)

    const heartbeat = setInterval(() => {
      void this.lock.renew(key, token, options.ttlMs).catch((err) => {
        this.logger.warn({ err, key }, 'Lock renewal failed')
      })
    }, options.renewMs)
    // Never let the renewal timer keep the event loop (or a Jest worker) alive.
    heartbeat.unref?.()

    try {
      return await fn()
    } finally {
      clearInterval(heartbeat)
      await this.lock.release(key, token).catch(() => undefined)
    }
  }
}
