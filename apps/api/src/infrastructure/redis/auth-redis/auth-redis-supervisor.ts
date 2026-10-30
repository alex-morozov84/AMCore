import { BoundedRedis, type BoundedRedisClient, BoundedRedisError } from '../bounded-redis.js'
import type { AppRedisClient } from '../redis-client-options.js'

import {
  AUTH_REDIS_DEFAULTS,
  type AuthRedisEvent,
  type AuthRedisGenerationState,
  type AuthRedisReplacementReason,
  type AuthRedisTiming,
} from './auth-redis.constants.js'

interface Generation {
  readonly id: number
  readonly client: AppRedisClient
  readonly bounded: BoundedRedis
  /** Start time of every unsettled operation of this generation. */
  readonly ops: Map<symbol, number>
  state: AuthRedisGenerationState
  progressAt: number
  lastOkAt: number
  retiredAt?: number
}

export interface AuthRedisStats {
  generations: number
  live: AuthRedisGenerationState[]
  replacements: number
  backoff: number
  unsettled: number
}

const SERVING: AuthRedisGenerationState[] = ['connecting', 'active', 'reconnecting', 'failed']

/**
 * Owns exactly one client generation at a time and the only recovery logic for it.
 *
 * node-redis cannot bound a command that was already written, and `destroy()` rejects every
 * queued and written command at once. So a generation that stops answering is replaced:
 * a new client is created and the old one is destroyed. The disposal contract is LOGICAL
 * (`destroy()` returned and `isOpen === false`); physical socket closure is not promised.
 * A destroy that did not take effect keeps the generation counted as `leaked`.
 *
 * Replacement triggers: `stall` (oldest operation older than `stallMs`, flap cooldown that
 * doubles and resets after continuous health), `no-success`, `handshake` / `reconnect-hang`
 * (no connection-level progress), `unplanned-end` and `protocol-mismatch` (a heartbeat `PING`
 * that does not answer `PONG`; a diagnostic for one reproduced misaligned stream, not a
 * defense against arbitrary corruption). Capacity is one active generation plus at most
 * `retiringCap` retiring ones; history and log are bounded.
 */
export class AuthRedisSupervisor {
  private generations: Generation[] = []
  private readonly timing: AuthRedisTiming
  private backoff = 0
  private lastFlapReplaceAt = -Infinity
  private lastSpawnAt = -Infinity
  private healthySince: number | null = null
  private sequence = 0
  private replacementCount = 0
  private stopped = false
  private tickTimer?: NodeJS.Timeout
  private pingTimer?: NodeJS.Timeout

  constructor(
    private readonly createClient: () => AppRedisClient,
    private readonly emit: (event: AuthRedisEvent) => void,
    timing: Partial<AuthRedisTiming> = {},
    private readonly now: () => number = () => performance.now()
  ) {
    this.timing = { ...AUTH_REDIS_DEFAULTS, ...timing }
  }

  start(): void {
    this.spawn()
    this.tickTimer = setInterval(() => this.tick(), this.timing.tickMs)
    this.pingTimer = setInterval(() => this.heartbeat(), this.timing.pingMs)
    this.tickTimer.unref()
    this.pingTimer.unref()
  }

  /** Runs one operation on the active generation under the shared `BoundedRedis` contract. */
  run<T>(
    operation: (client: BoundedRedisClient, signal: AbortSignal) => Promise<T>,
    deadlineMs?: number
  ): Promise<T> {
    const generation = this.current
    if (this.stopped || !generation || generation.state !== 'active' || !generation.client.isReady)
      return Promise.reject(new BoundedRedisError('not_ready', 'not_sent'))
    const id = Symbol('auth-redis-op')
    const result = generation.bounded.run((client, signal) => {
      const issued = operation(client, signal)
      generation.ops.set(id, this.now())
      const done = (): void => {
        generation.ops.delete(id)
      }
      issued.then(done, done)
      return issued
    }, deadlineMs)
    result.then(
      () => {
        generation.lastOkAt = this.now()
      },
      () => undefined
    )
    return result
  }

  get ready(): boolean {
    return this.current?.state === 'active' && this.current.client.isReady
  }

  stats(): AuthRedisStats {
    return {
      generations: this.generations.length,
      live: this.generations.filter((g) => g.state !== 'closed').map((g) => g.state),
      replacements: this.replacementCount,
      backoff: this.backoff,
      unsettled: this.generations.reduce((sum, g) => sum + g.bounded.unsettledCount, 0),
    }
  }

  /** Disposes every generation logically and returns at once; no physical-close claim. */
  stop(): { logicallyOpen: number } {
    this.stopped = true
    clearInterval(this.tickTimer)
    clearInterval(this.pingTimer)
    for (const generation of this.generations)
      if (generation.state !== 'closed') this.dispose(generation)
    return { logicallyOpen: this.generations.filter((g) => g.state !== 'closed').length }
  }

  private get current(): Generation | undefined {
    return this.generations.find((g) => SERVING.includes(g.state))
  }

  private spawn(): Generation {
    this.lastSpawnAt = this.now()
    const client = this.createClient()
    const generation: Generation = {
      id: this.sequence++,
      client,
      bounded: new BoundedRedis(client),
      ops: new Map(),
      state: 'connecting',
      progressAt: this.now(),
      lastOkAt: 0,
    }
    client.on('error', (error: unknown) => {
      generation.progressAt = this.now()
      this.emit({ kind: 'client-error', generation: generation.id, error })
    })
    client.on('reconnecting', () => {
      generation.progressAt = this.now()
      this.emit({ kind: 'reconnecting', generation: generation.id })
      if (generation.state === 'active') this.markReconnecting(generation)
    })
    client.on('ready', () => {
      if (generation.state === 'connecting' || generation.state === 'reconnecting')
        generation.state = 'active'
      generation.progressAt = generation.lastOkAt = this.now()
    })
    client.on('end', () => {
      if (generation.state === 'retiring' || generation.state === 'leaked')
        generation.state = 'closed'
      else if (generation.state !== 'closed') generation.state = 'failed'
    })
    this.generations.push(generation)
    client.connect().catch(() => undefined)
    return generation
  }

  private markReconnecting(generation: Generation): void {
    if (generation.state !== 'active') return
    generation.state = 'reconnecting'
    generation.progressAt = this.now()
    this.healthySince = null
  }

  private heartbeat(): void {
    const generation = this.current
    if (this.stopped || !generation) return
    this.run((client) => client.ping(), this.timing.pingDeadlineMs).then(
      (reply) => {
        if (reply === 'PONG') generation.lastOkAt = this.now()
        else this.mismatch(generation)
      },
      () => undefined
    )
  }

  private mismatch(generation: Generation): void {
    this.emit({ kind: 'alert', alert: 'protocol-mismatch', generation: generation.id })
    const settled = this.now() - this.lastSpawnAt >= this.timing.spawnCadenceMs
    if (generation === this.current && generation.state === 'active' && settled)
      this.replace(generation, 'protocol-mismatch', false)
  }

  private tick(): void {
    if (this.stopped) return
    const t = this.now()
    this.pruneAndRetire(t)
    const generation = this.current
    if (!generation) return
    if (generation.state === 'active' && !generation.client.isReady)
      this.markReconnecting(generation)

    const oldest = generation.ops.size ? t - Math.min(...generation.ops.values()) : 0
    const active = generation.state === 'active'
    const stalled = active && oldest > this.timing.stallMs
    const noSuccess =
      active &&
      generation.client.isReady &&
      !stalled &&
      t - generation.lastOkAt > this.timing.noSuccessMs
    const connecting = generation.state === 'connecting' || generation.state === 'reconnecting'
    const handshakeHang = connecting && t - generation.progressAt > this.timing.notReadyMs
    const ended =
      generation.state === 'failed' && t - this.lastSpawnAt >= this.timing.spawnCadenceMs
    const healthy =
      active &&
      generation.client.isReady &&
      !stalled &&
      t - generation.lastOkAt <= this.timing.okFreshMs
    this.trackHealth(healthy, t)

    if (stalled) this.replace(generation, 'stall', true)
    else if (noSuccess) this.replace(generation, 'no-success', true)
    else if (handshakeHang)
      this.replace(
        generation,
        generation.state === 'reconnecting' ? 'reconnect-hang' : 'handshake',
        false
      )
    else if (ended) this.replace(generation, 'unplanned-end', false)
  }

  private trackHealth(healthy: boolean, t: number): void {
    if (!healthy) {
      this.healthySince = null
      return
    }
    this.healthySince ??= t
    if (t - this.healthySince >= this.timing.healthyResetMs) this.backoff = 0
  }

  private pruneAndRetire(t: number): void {
    for (const generation of this.generations) {
      const disposing = generation.state === 'retiring' || generation.state === 'leaked'
      if (disposing && !generation.client.isOpen) generation.state = 'closed'
      else if (
        generation.state === 'retiring' &&
        t - (generation.retiredAt ?? t) > this.timing.retireMaxMs
      ) {
        generation.state = 'leaked'
        this.emit({ kind: 'alert', alert: 'retire-timeout', generation: generation.id })
      }
    }
    const closed = this.generations.filter((g) => g.state === 'closed')
    if (closed.length > this.timing.history) {
      const drop = new Set(closed.slice(0, closed.length - this.timing.history))
      this.generations = this.generations.filter((g) => !drop.has(g))
    }
  }

  private replace(
    old: Generation,
    reason: AuthRedisReplacementReason,
    flapGoverned: boolean
  ): void {
    const t = this.now()
    if (flapGoverned) {
      const wait = Math.min(this.timing.flapMaxMs, this.timing.flapMinMs * 2 ** this.backoff)
      if (t - this.lastFlapReplaceAt < wait) return
      this.lastFlapReplaceAt = t
      this.backoff = Math.min(this.backoff + 1, 3)
    }
    const retiring = this.generations.filter((g) => g.state === 'retiring' || g.state === 'leaked')
    if (retiring.length >= this.timing.retiringCap) {
      this.emit({ kind: 'alert', alert: 'retiring-cap', generation: old.id })
      return
    }
    this.replacementCount++
    this.emit({ kind: 'replaced', generation: old.id, reason })
    this.dispose(old)
    this.spawn()
  }

  /** Marks the generation retiring, destroys the client and checks the logical boundary. */
  private dispose(generation: Generation): void {
    generation.state = 'retiring'
    generation.retiredAt = this.now()
    try {
      generation.client.destroy()
    } catch {
      // already closed
    }
    if (!generation.client.isOpen) generation.state = 'closed'
  }
}
