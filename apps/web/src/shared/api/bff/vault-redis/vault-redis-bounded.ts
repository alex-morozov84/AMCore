import type { WebRedisClient } from '../redis-client'

import {
  VAULT_REDIS_CAPACITY,
  VAULT_REDIS_DEADLINE_MS,
  type VaultRedisClient,
  VaultRedisError,
} from './vault-redis-types'

/**
 * Bounds how long a caller waits for ONE client generation, and how much unsettled work that
 * generation may hold. node-redis drops its abort and timeout listeners once a command is written,
 * so the deadline is a race the caller loses on purpose: a typed error, queued commands aborted, an
 * already-written command may still execute. Nothing is retried. A slot is released only when the
 * underlying promise settles (reply, error or connection close), never when the caller gives up.
 */
export class VaultRedisBounded {
  private unsettled = 0

  constructor(private readonly client: WebRedisClient) {}

  get unsettledCount(): number {
    return this.unsettled
  }

  run<T>(
    operation: (client: VaultRedisClient, signal: AbortSignal) => Promise<T>,
    deadlineMs = VAULT_REDIS_DEADLINE_MS
  ): Promise<T> {
    if (this.unsettled >= VAULT_REDIS_CAPACITY)
      return Promise.reject(new VaultRedisError('capacity', 'not_sent'))
    if (!this.client.isReady) return Promise.reject(new VaultRedisError('not_ready', 'not_sent'))

    const controller = new AbortController()
    this.unsettled++
    let issued: Promise<T>
    try {
      issued = operation(
        this.client.withCommandOptions({ abortSignal: controller.signal }),
        controller.signal
      )
    } catch (cause) {
      this.unsettled--
      return Promise.reject(new VaultRedisError('dispatch', 'not_sent', { cause }))
    }
    const release = (): void => {
      this.unsettled--
    }
    issued.then(release, release)

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new VaultRedisError('deadline', 'unknown'))
        controller.abort()
      }, deadlineMs)
      issued.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (cause: unknown) => {
          clearTimeout(timer)
          reject(new VaultRedisError('command', 'unknown', { cause }))
        }
      )
    })
  }
}
