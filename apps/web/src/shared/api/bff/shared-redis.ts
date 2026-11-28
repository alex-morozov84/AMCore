import { SessionVaultUnavailableError } from './errors'
import { getWebRedisClient, type WebRedisClient } from './redis-client'
import { redisDeadline } from './redis-deadline'
import {
  VAULT_REDIS_CAPACITY,
  VAULT_REDIS_DEADLINE_MS,
  VaultRedisError,
} from './vault-redis/vault-redis-types'

import 'server-only'

type CommandClient = ReturnType<WebRedisClient['withCommandOptions']>
const CSP_CAPACITY = 8
let unsettled = 0
let unsettledCsp = 0

export class CspRedisCapacityError extends Error {}

/** One deadline for the Redis commands that belong to this store access. */
export function sharedRedis(timeoutMs = VAULT_REDIS_DEADLINE_MS, csp = false) {
  const { expiresAt, signal } = redisDeadline(timeoutMs)
  const remaining = () => Math.ceil(expiresAt - performance.now())

  async function run<T>(command: (client: CommandClient) => Promise<T>): Promise<T> {
    let sentToClient = false
    const timeout = () =>
      new SessionVaultUnavailableError(
        new VaultRedisError('deadline', sentToClient ? 'unknown' : 'not_sent')
      )
    const time = remaining()
    if (time <= 0 || signal?.aborted) throw timeout()
    if (csp && unsettledCsp >= CSP_CAPACITY) throw new CspRedisCapacityError()
    if (unsettled >= VAULT_REDIS_CAPACITY) throw new SessionVaultUnavailableError(undefined)

    const controller = new AbortController()
    const abort = () => controller.abort()
    const timer = setTimeout(abort, time)
    signal?.addEventListener('abort', abort, { once: true })
    let rejectAbort: () => void = () => undefined
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(timeout())
      controller.signal.addEventListener('abort', rejectAbort, { once: true })
    })

    // Count connection waiters as well. A stuck shared connection cannot retain
    // arbitrarily many continuations after their callers have timed out.
    unsettled++
    if (csp) unsettledCsp++
    const work = (async () => {
      const client = await getWebRedisClient()
      const configured = client.withCommandOptions({ abortSignal: controller.signal })
      if (controller.signal.aborted || remaining() <= 0) throw timeout()
      if (!client.isReady) throw new SessionVaultUnavailableError(undefined)
      sentToClient = true
      return command(configured)
    })()
    const release = () => {
      unsettled--
      if (csp) unsettledCsp--
    }
    work.then(release, release)

    try {
      return await Promise.race([work, aborted])
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', rejectAbort)
    }
  }

  return {
    get: (...args: Parameters<CommandClient['get']>) => run((client) => client.get(...args)),
    set: (...args: Parameters<CommandClient['set']>) => run((client) => client.set(...args)),
    eval: (...args: Parameters<CommandClient['eval']>) => run((client) => client.eval(...args)),
  }
}
