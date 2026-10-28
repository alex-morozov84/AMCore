import { Injectable } from '@nestjs/common'

import { ABUSE_COUNTER_INCREMENT_SCRIPT, ABUSE_COUNTER_READ_SCRIPT } from './abuse-counter.lua.js'
import { BoundedRedis, BoundedRedisError, type BoundedRedisOutcome } from './bounded-redis.js'

export interface AbuseCounts {
  readonly ip: number
  readonly subject: number
}

export type AbuseCounterFailure = 'unavailable' | 'invalid_state' | 'invalid_reply'

/** Counter access failed. `outcome` says whether a write may have happened (see BoundedRedis). */
export class AbuseCounterError extends Error {
  constructor(
    readonly kind: AbuseCounterFailure,
    readonly outcome: BoundedRedisOutcome,
    options?: { cause?: unknown }
  ) {
    super(`Abuse counter failed: ${kind}`, options)
    this.name = 'AbuseCounterError'
  }
}

const MAX_TTL_MS = 86_400_000

/**
 * Failure counters over two keys: one per source address and one per credential
 * fingerprint. Values are plain integers with an expiry that every `increment` renews
 * (inactivity expiry, not a strict sliding window); `read` never writes. It does not
 * reserve admission: concurrent requests that already passed a `read` can exceed a limit.
 * Standalone Redis only: the two keys are not guaranteed to share a cluster slot.
 */
@Injectable()
export class AbuseCounterStore {
  constructor(private readonly redis: BoundedRedis) {}

  read(ipKey: string, subjectKey: string): Promise<AbuseCounts> {
    return this.counts(ABUSE_COUNTER_READ_SCRIPT, [ipKey, subjectKey], [])
  }

  increment(ipKey: string, subjectKey: string, ttlMs: number): Promise<AbuseCounts> {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS)
      throw new RangeError('Abuse counter expiry must be an integer between 1 ms and 24 h')
    return this.counts(ABUSE_COUNTER_INCREMENT_SCRIPT, [ipKey, subjectKey], [String(ttlMs)])
  }

  /** Deletes one key. A delayed delete can also remove increments written after it was sent. */
  async clear(subjectKey: string): Promise<void> {
    await this.bounded(() => this.redis.run((client) => client.del(subjectKey)))
  }

  private async counts(script: string, keys: string[], args: string[]): Promise<AbuseCounts> {
    const reply: unknown = await this.bounded(() =>
      this.redis.run((client) => client.eval(script, { keys, arguments: args }))
    )
    if (!Array.isArray(reply) || reply.length !== 2 || !reply.every(Number.isSafeInteger))
      throw new AbuseCounterError('invalid_reply', 'unknown')
    const [ip, subject] = reply as [number, number]
    // A script refusal happens before any write, so nothing was recorded.
    if (ip === -1 && subject === -1) throw new AbuseCounterError('invalid_state', 'not_sent')
    if (ip < 0 || subject < 0) throw new AbuseCounterError('invalid_reply', 'unknown')
    return { ip, subject }
  }

  private async bounded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (error instanceof BoundedRedisError)
        throw new AbuseCounterError('unavailable', error.outcome, { cause: error })
      throw error
    }
  }
}
