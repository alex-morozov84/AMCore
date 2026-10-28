import { Inject, Injectable } from '@nestjs/common'

import { REDIS_CLIENT } from './redis.constants.js'
import type { AppRedisClient } from './redis-connection.service.js'

/** Starting values; the sizing evidence recorded with the change decides the final ones. */
export const BOUNDED_REDIS_DEADLINE_MS = 250
export const BOUNDED_REDIS_STALLED_CAPACITY = 64

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
 * Bounds how long a caller waits for the shared Redis client, nothing more.
 *
 * node-redis drops its abort and timeout listeners once a command is written, so a
 * server that withholds a reply would leave the promise pending. The deadline here is
 * therefore a race the caller loses on purpose: the caller gets a typed error, queued
 * commands are aborted, and an already-written command may still execute. Nothing is
 * retried.
 *
 * Capacity counts only operations that have outlived their deadline and are still
 * unsettled ("stalled"). A slot is released when the underlying promise settles (reply,
 * error or connection close), never when the caller gives up, so stalled work stays
 * counted and bounded. Operations still inside their deadline are not counted: they are
 * limited by how many requests the process is already serving, and counting them would
 * refuse healthy bursts. Other users of the shared client bypass this helper and are
 * not bounded by it. It never closes or reconnects the client.
 */
@Injectable()
export class BoundedRedis {
  private stalled = 0

  constructor(@Inject(REDIS_CLIENT) private readonly redis: AppRedisClient) {}

  run<T>(
    operation: (client: BoundedRedisClient, signal: AbortSignal) => Promise<T>,
    deadlineMs = BOUNDED_REDIS_DEADLINE_MS
  ): Promise<T> {
    if (this.stalled >= BOUNDED_REDIS_STALLED_CAPACITY)
      return Promise.reject(new BoundedRedisError('capacity', 'not_sent'))
    if (!this.redis.isReady) return Promise.reject(new BoundedRedisError('not_ready', 'not_sent'))

    const controller = new AbortController()
    let issued: Promise<T>
    try {
      issued = operation(
        this.redis.withCommandOptions({ abortSignal: controller.signal }),
        controller.signal
      )
    } catch (cause) {
      return Promise.reject(new BoundedRedisError('dispatch', 'not_sent', { cause }))
    }

    let isStalled = false
    const release = (): void => {
      if (isStalled) this.stalled--
    }
    issued.then(release, release)

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        isStalled = true
        this.stalled++
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
