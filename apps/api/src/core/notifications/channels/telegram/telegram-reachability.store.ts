import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { MetricsService } from '../../../../infrastructure/observability/index.js'
import { type AppRedisClient, REDIS_CLIENT } from '../../../../infrastructure/redis/index.js'

import { TELEGRAM_REACHABILITY, type TelegramObservation } from './telegram-reachability.policy.js'
import {
  DELETE_SCRIPT,
  READ_SCRIPT,
  telegramCheckKeys,
  WRITE_SCRIPT,
} from './telegram-reachability.scripts.js'

export type TelegramWriteOutcome = 'stored' | 'late' | 'overflow' | 'unavailable'

export interface TelegramObservationSnapshot {
  now: number
  overflow: { since: number; lastRefusedAt: number } | null
  /** Raw stored values by worker instance id; the reader validates each one. */
  fields: [string, string][]
}

type Client = Pick<AppRedisClient, 'isReady' | 'withCommandOptions'>

/** Run one command with a hard deadline; any failure is `undefined`, never an exception. */
async function bounded<T>(
  client: Client | undefined,
  timeoutMs: number,
  run: (bound: ReturnType<AppRedisClient['withCommandOptions']>) => Promise<T>
): Promise<T | undefined> {
  if (!client?.isReady) return undefined
  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(undefined)
    }, timeoutMs + 50)
  })
  try {
    return await Promise.race([
      run(client.withCommandOptions({ abortSignal: controller.signal, timeout: timeoutMs })),
      deadline,
    ])
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The Console reader's single read: one read-only script, so the set of workers, the overflow
 * marker and the clock are one consistent snapshot. `undefined` when Redis did not answer in time.
 */
export async function readTelegramObservations(
  client: Client,
  timeoutMs: number
): Promise<TelegramObservationSnapshot | undefined> {
  const reply = await bounded(client, timeoutMs, (bound) =>
    bound.eval(READ_SCRIPT, {
      keys: [telegramCheckKeys.observations, telegramCheckKeys.overflow],
      arguments: [],
    })
  )
  if (!Array.isArray(reply) || reply.length < 2 || reply.length % 2 !== 0) return undefined
  const values = reply.map(String)
  const marker = /^(\d+):(\d+)$/.exec(values[1] ?? '')
  const fields: [string, string][] = []
  for (let i = 2; i < values.length; i += 2) fields.push([values[i]!, values[i + 1]!])
  return {
    now: Number(values[0]),
    overflow: marker ? { since: Number(marker[1]), lastRefusedAt: Number(marker[2]) } : null,
    fields,
  }
}

/**
 * Worker side. A dedicated connection without the offline queue: while Redis is away a command
 * fails at once instead of waiting and later stamping an old result as new. A command that timed
 * out after being sent may still run; the write script then refuses it as late.
 */
@Injectable()
export class TelegramReachabilityStore {
  private client?: AppRedisClient

  constructor(
    @Inject(REDIS_CLIENT) private readonly shared: AppRedisClient,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(TelegramReachabilityStore.name)
  }

  /** Opened by the check on its first run, so a worker without Telegram opens nothing. */
  open(): void {
    if (this.client) return
    const client = this.shared.duplicate({ disableOfflineQueue: true })
    // Listeners before connect: an 'error' without a listener would crash the process.
    client.on('error', (err: unknown) => {
      this.metrics.incRedisClientEvent('telegram_check', 'error')
      this.logger.warn({ event: 'telegram_check_redis_error', err })
    })
    client.on('reconnecting', () =>
      this.metrics.incRedisClientEvent('telegram_check', 'reconnecting')
    )
    this.client = client
    // Never blocks start-up: a Redis outage only makes writes report `unavailable`.
    client.connect().catch(() => undefined)
  }

  /** Redis `TIME` in milliseconds, the clock of every stored observation. */
  async now(): Promise<number | undefined> {
    const reply = await bounded(this.client, TELEGRAM_REACHABILITY.redisCommandMs, (bound) =>
      bound.sendCommand<string[]>(['TIME'])
    )
    if (!Array.isArray(reply)) return undefined
    return Number(reply[0]) * 1000 + Math.floor(Number(reply[1]) / 1000)
  }

  async write(instanceId: string, observation: TelegramObservation): Promise<TelegramWriteOutcome> {
    const reply = await bounded(this.client, TELEGRAM_REACHABILITY.redisCommandMs, (bound) =>
      bound.eval(WRITE_SCRIPT, {
        keys: [telegramCheckKeys.observations, telegramCheckKeys.overflow],
        arguments: [
          instanceId,
          JSON.stringify(observation),
          String(observation.observedAt),
          String(observation.seq),
          String(TELEGRAM_REACHABILITY.retentionMs),
          String(TELEGRAM_REACHABILITY.maxWorkers),
          String(TELEGRAM_REACHABILITY.maxWriteDelayMs),
        ],
      })
    )
    return reply === 'stored' || reply === 'late' || reply === 'overflow' ? reply : 'unavailable'
  }

  /** Best effort; a failure leaves the result to age into stale and expire. */
  async remove(instanceId: string): Promise<boolean> {
    const reply = await bounded(this.client, TELEGRAM_REACHABILITY.redisCommandMs, (bound) =>
      bound.eval(DELETE_SCRIPT, { keys: [telegramCheckKeys.observations], arguments: [instanceId] })
    )
    return reply !== undefined
  }

  /** Called by the check after its own cleanup, so the connection outlives the final delete. */
  async close(): Promise<void> {
    const client = this.client
    this.client = undefined
    if (!client) return
    try {
      if (client.isReady) await client.close()
      else client.destroy()
    } catch {
      client.destroy()
    }
  }
}
