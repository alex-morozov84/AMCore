import type { WebRedisClient } from '../redis-client'

import { VaultRedisBounded } from './vault-redis-bounded'
import {
  VAULT_REDIS_TIMING,
  type VaultGenerationState,
  type VaultRedisClient,
  VaultRedisError,
  type VaultRedisEvent,
  type VaultRedisTiming,
  type VaultReplacementReason,
} from './vault-redis-types'

interface Generation {
  readonly id: number
  readonly client: WebRedisClient
  readonly bounded: VaultRedisBounded
  /** Start time of every unsettled operation of this generation. */
  readonly ops: Map<symbol, number>
  state: VaultGenerationState
  progressAt: number
  lastOkAt: number
  retiredAt?: number
}

export interface VaultRedisStats {
  generations: number
  live: VaultGenerationState[]
  replacements: number
  backoff: number
  unsettled: number
}

const SERVING: VaultGenerationState[] = ['connecting', 'active', 'reconnecting', 'failed']

/**
 * Owns exactly one client generation at a time and the only recovery logic for the session vault
 * connection. Same state machine as the API's authentication client (T082): node-redis cannot bound
 * a command that was already written and `destroy()` rejects every queued and written command at
 * once, so a generation that stops answering is replaced. Disposal is LOGICAL (`destroy()` returned
 * and `isOpen === false`); a destroy that had no effect stays counted as `leaked`. The heartbeat
 * `PONG` check is a diagnostic for one reproduced misaligned stream, not a defense against
 * arbitrary corruption.
 */
export class VaultRedisSupervisor {
  private generations: Generation[] = []
  private readonly timing: VaultRedisTiming
  private backoff = 0
  private lastFlapReplaceAt = -Infinity
  private lastSpawnAt = -Infinity
  private healthySince: number | null = null
  private sequence = 0
  private replacementCount = 0
  private stopped = false
  private tickTimer?: ReturnType<typeof setInterval>
  private pingTimer?: ReturnType<typeof setInterval>

  constructor(
    private readonly createClient: () => WebRedisClient,
    private readonly emit: (event: VaultRedisEvent) => void,
    timing: Partial<VaultRedisTiming> = {},
    private readonly now: () => number = () => performance.now()
  ) {
    this.timing = { ...VAULT_REDIS_TIMING, ...timing }
  }

  start(): void {
    this.spawn()
    this.tickTimer = setInterval(() => this.tick(), this.timing.tickMs)
    this.pingTimer = setInterval(() => this.heartbeat(), this.timing.pingMs)
    this.tickTimer.unref?.()
    this.pingTimer.unref?.()
  }

  run<T>(
    operation: (client: VaultRedisClient, signal: AbortSignal) => Promise<T>,
    deadlineMs?: number
  ): Promise<T> {
    const generation = this.current
    if (this.stopped || !generation || generation.state !== 'active' || !generation.client.isReady)
      return Promise.reject(new VaultRedisError('not_ready', 'not_sent'))
    const id = Symbol('vault-redis-op')
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

  stats(): VaultRedisStats {
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
      bounded: new VaultRedisBounded(client),
      ops: new Map(),
      state: 'connecting',
      progressAt: this.now(),
      lastOkAt: 0,
    }
    this.listen(generation)
    this.generations.push(generation)
    client.connect().catch(() => undefined)
    return generation
  }

  /** Connection-level events are the only progress signal a not-yet-ready generation gives. */
  private listen(generation: Generation): void {
    const { client } = generation
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

    const verdict = this.assess(generation, t)
    this.trackHealth(verdict.healthy, t)
    if (verdict.replace)
      this.replace(generation, verdict.replace.reason, verdict.replace.flapGoverned)
  }

  /** Pure decision table: is this generation healthy, and does it need replacing, and why? */
  private assess(
    generation: Generation,
    t: number
  ): { healthy: boolean; replace?: { reason: VaultReplacementReason; flapGoverned: boolean } } {
    const oldest = generation.ops.size ? t - Math.min(...generation.ops.values()) : 0
    const active = generation.state === 'active'
    const ready = active && generation.client.isReady
    const stalled = active && oldest > this.timing.stallMs
    const sinceOk = t - generation.lastOkAt
    const healthy = ready && !stalled && sinceOk <= this.timing.okFreshMs
    if (stalled) return { healthy, replace: { reason: 'stall', flapGoverned: true } }
    if (ready && sinceOk > this.timing.noSuccessMs)
      return { healthy, replace: { reason: 'no-success', flapGoverned: true } }
    const hung =
      (generation.state === 'connecting' || generation.state === 'reconnecting') &&
      t - generation.progressAt > this.timing.notReadyMs
    if (hung) {
      const reason = generation.state === 'reconnecting' ? 'reconnect-hang' : 'handshake'
      return { healthy, replace: { reason, flapGoverned: false } }
    }
    const ended =
      generation.state === 'failed' && t - this.lastSpawnAt >= this.timing.spawnCadenceMs
    return ended
      ? { healthy, replace: { reason: 'unplanned-end', flapGoverned: false } }
      : { healthy }
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

  private replace(old: Generation, reason: VaultReplacementReason, flapGoverned: boolean): void {
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
