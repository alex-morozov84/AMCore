import { Inject, Injectable } from '@nestjs/common'

import { REDIS_CLIENT } from './redis.constants.js'
import type { AppRedisClient } from './redis-connection.service.js'

/** Starting values; the sizing evidence recorded with the change decides the final ones. */
export const BOUNDED_REDIS_DEADLINE_MS = 250
/**
 * Unsettled operations one process may hold through this helper. Sized from a measured
 * 500-request burst (peak 168 concurrent operations per instance) with about 6x headroom;
 * each held operation costs roughly 5 KB, so a full helper holds about 5 MB.
 */
export const BOUNDED_REDIS_CAPACITY = 1024

export type BoundedRedisClient = ReturnType<AppRedisClient['withCommandOptions']>
export type BoundedRedisReason = 'capacity' | 'not_ready' | 'dispatch' | 'deadline' | 'command'
/** `not_sent` only when the command provably never left; anything later is `unknown`. */
export type BoundedRedisOutcome = 'not_sent' | 'unknown'

export class BoundedRedisError extends Error {
  constructor(
    readonly reason: BoundedRedisReason,
    readonly outcome: BoundedRedisOutcome,
    options?: { cause?: unknown }
  ) {
    super(`Redis operation failed: ${reason}`, options)
    this.name = 'BoundedRedisError'
  }
}

/**
 * Bounds how long a caller waits for the shared Redis client, and how much unsettled
 * work this helper may hold. Nothing more.
 *
 * node-redis drops its abort and timeout listeners once a command is written, so a
 * server that withholds a reply would leave the promise pending. The deadline here is
 * therefore a race the caller loses on purpose: the caller gets a typed error, queued
 * commands are aborted, and an already-written command may still execute. Nothing is
 * retried.
 *
 * Admission reserves a slot before the operation is dispatched. When all slots are held
 * the call is refused at once as `not_sent`. A slot is released only when the underlying
 * promise settles (reply, error or connection close), never when the caller gives up,
 * so work that is still unsettled after its deadline stays counted and the number held
 * never exceeds the capacity. Other users of the shared client bypass this helper and
 * are not bounded by it. It never closes or reconnects the client.
 *
 * An operation callback must not issue work before it can throw: a synchronous throw is
 * reported as `not_sent`.
 */
@Injectable()
export class BoundedRedis {
  private unsettled = 0

  constructor(@Inject(REDIS_CLIENT) private readonly redis: AppRedisClient) {}

  /** Operations admitted through this helper that have not settled yet (diagnostics). */
  get unsettledCount(): number {
    return this.unsettled
  }

  run<T>(
    operation: (client: BoundedRedisClient, signal: AbortSignal) => Promise<T>,
    deadlineMs = BOUNDED_REDIS_DEADLINE_MS
  ): Promise<T> {
    if (this.unsettled >= BOUNDED_REDIS_CAPACITY)
      return Promise.reject(new BoundedRedisError('capacity', 'not_sent'))
    if (!this.redis.isReady) return Promise.reject(new BoundedRedisError('not_ready', 'not_sent'))

    const controller = new AbortController()
    this.unsettled++
    let issued: Promise<T>
    try {
      issued = operation(
        this.redis.withCommandOptions({ abortSignal: controller.signal }),
        controller.signal
      )
    } catch (cause) {
      this.unsettled--
      return Promise.reject(new BoundedRedisError('dispatch', 'not_sent', { cause }))
    }
    const release = (): void => {
      this.unsettled--
    }
    issued.then(release, release)

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new BoundedRedisError('deadline', 'unknown'))
        controller.abort()
      }, deadlineMs)
      issued.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (cause: unknown) => {
          clearTimeout(timer)
          reject(new BoundedRedisError('command', 'unknown', { cause }))
        }
      )
    })
  }
}
