import { Injectable, type OnModuleInit } from '@nestjs/common'
import type { Queue } from 'bullmq'

import type { AdminQueue, AdminQueueAge, AdminQueueCounts } from '@amcore/shared'

import { QUEUE_INVENTORY, type QueueDescriptor } from './constants/queue-inventory.constant'
import { QueueService } from './queue.service'

/** Absolute budget of one collection unit; callers never wait longer. */
export const QUEUE_OBSERVATION_DEADLINE_MS = 1000
/** Ids sampled per list (`wait` tail, `prioritized` head) for the age estimate. */
export const QUEUE_AGE_SAMPLE_SIZE = 16

interface ObservationPipeline {
  llen(key: string): this
  zcard(key: string): this
  zrange(key: string, start: number, end: number): this
  lrange(key: string, start: number, end: number): this
  hexists(key: string, field: string): this
  hget(key: string, field: string): this
  exec(): Promise<Array<[Error | null, unknown]> | null>
}

/**
 * The resolved producer client, narrowed to the read commands used here. BullMQ's own
 * transaction typing omits `zcard/hexists/hget`; the underlying client is ioredis.
 */
interface ObservationClient {
  status: string
  pipeline(): ObservationPipeline
}

interface StageA {
  counts: AdminQueueCounts
  paused: boolean
  sampledAt: string
  ids: string[] | null
}
type UnitResult =
  { kind: 'complete'; value: Extract<AdminQueue, { status: 'available' }> } | { kind: 'discarded' }

interface Unit {
  readonly startedAt: number
  expired: boolean
  stageA: StageA | null
  result: Promise<UnitResult>
}

const unavailable = (d: QueueDescriptor): AdminQueue => ({
  name: d.name,
  kind: d.kind,
  status: 'unavailable',
})

/**
 * Read-only, payload-free observation of the queue inventory (counts, global pause flag, and a
 * bounded creation-age sample). It issues plain Redis reads (no BullMQ getter scripts, so zero
 * Redis writes) and keeps Redis work bounded independently of how often it is called:
 *
 * 1. At most ONE collection unit is alive per queue. It is freed only when its promise really
 *    settles; expiry marks it expired but never replaces it.
 * 2. A caller whose queue has no ready client, or whose unit expired, gets `unavailable`
 *    immediately without attaching any handler to the unit's promise.
 * 3. Stage A (one 9-command pipeline: counts, pause flag, ids) then, only if time remains,
 *    Stage B (one pipeline of up to 32 timestamp-only `HGET`s). A late Stage A/B reply is
 *    discarded and never starts a further stage or counts as a fresh snapshot.
 * 4. A Stage B failure or timeout keeps the valid counts with `age: unknown`.
 *
 * The producer client is retained when it resolves and is never awaited inside a request, so a
 * cold start with Redis down cannot hang a read.
 */
@Injectable()
export class QueueObservationService implements OnModuleInit {
  private readonly clients = new Map<string, ObservationClient>()
  private readonly units = new Map<string, Unit>()

  constructor(private readonly queues: QueueService) {}

  onModuleInit(): void {
    for (const { name } of QUEUE_INVENTORY) {
      const queue = this.queues.getQueue(name)
      if (!queue) continue
      void queue
        .getBackend()
        .client.then((client) => this.clients.set(name, client as unknown as ObservationClient))
        .catch(() => undefined)
    }
  }

  observe(inventory: readonly QueueDescriptor[] = QUEUE_INVENTORY): Promise<AdminQueue[]> {
    return Promise.all(inventory.map((descriptor) => this.observeQueue(descriptor)))
  }

  private async observeQueue(descriptor: QueueDescriptor): Promise<AdminQueue> {
    if (!descriptor.enabled) {
      return { name: descriptor.name, kind: descriptor.kind, status: 'disabled' }
    }
    const queue = this.queues.getQueue(descriptor.name)
    const client = this.clients.get(descriptor.name)
    if (!queue || !client || client.status !== 'ready') return unavailable(descriptor)

    let unit = this.units.get(descriptor.name)
    if (unit && (unit.expired || Date.now() - unit.startedAt >= QUEUE_OBSERVATION_DEADLINE_MS)) {
      unit.expired = true
      return unavailable(descriptor)
    }
    unit ??= this.startUnit(descriptor, queue, client)
    return this.await(descriptor, unit)
  }

  private async await(descriptor: QueueDescriptor, unit: Unit): Promise<AdminQueue> {
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<'deadline'>((resolve) => {
      timer = setTimeout(
        () => resolve('deadline'),
        Math.max(0, QUEUE_OBSERVATION_DEADLINE_MS - (Date.now() - unit.startedAt))
      )
    })
    try {
      const outcome = await Promise.race([unit.result, deadline])
      if (outcome === 'deadline') {
        unit.expired = true
        // Counts that were already read stay valid when only the optional age stage is slow.
        const partial = unit.stageA
        return partial
          ? this.available(descriptor, partial, { status: 'unknown' })
          : unavailable(descriptor)
      }
      return outcome.kind === 'complete' ? outcome.value : unavailable(descriptor)
    } catch {
      return unavailable(descriptor)
    } finally {
      clearTimeout(timer)
    }
  }

  private startUnit(descriptor: QueueDescriptor, queue: Queue, client: ObservationClient): Unit {
    const startedAt = Date.now()
    const unit: Unit = {
      startedAt,
      expired: false,
      stageA: null,
      result: Promise.resolve({ kind: 'discarded' }),
    }
    unit.result = this.collect(descriptor, queue, client, unit)
    this.units.set(descriptor.name, unit)
    // The single reaction that frees the slot, only at real settlement.
    void unit.result
      .catch(() => undefined)
      .finally(() => {
        if (this.units.get(descriptor.name) === unit) this.units.delete(descriptor.name)
      })
    return unit
  }

  private over(unit: Unit): boolean {
    return unit.expired || Date.now() - unit.startedAt >= QUEUE_OBSERVATION_DEADLINE_MS
  }

  private async collect(
    descriptor: QueueDescriptor,
    queue: Queue,
    client: ObservationClient,
    unit: Unit
  ): Promise<UnitResult> {
    const stageA = await this.readStageA(queue, client)
    if (this.over(unit)) return { kind: 'discarded' }
    unit.stageA = stageA

    const queued = stageA.counts.waiting + stageA.counts.prioritized
    let age: AdminQueueAge = { status: 'none' }
    if (queued > 0) {
      age = { status: 'unknown' }
      if (stageA.ids?.length) {
        const sampled = await this.readAge(queue, client, stageA.ids).catch(() => null)
        if (this.over(unit)) return { kind: 'discarded' }
        if (sampled) age = sampled
      }
    }
    return { kind: 'complete', value: this.available(descriptor, stageA, age) }
  }

  private available(
    descriptor: QueueDescriptor,
    stage: StageA,
    age: AdminQueueAge
  ): Extract<AdminQueue, { status: 'available' }> {
    return {
      name: descriptor.name,
      kind: descriptor.kind,
      status: 'available',
      sampledAt: stage.sampledAt,
      paused: stage.paused,
      counts: stage.counts,
      age,
    }
  }

  private async readStageA(queue: Queue, client: ObservationClient): Promise<StageA> {
    const replies = await client
      .pipeline()
      .llen(queue.toKey('wait'))
      .zcard(queue.toKey('prioritized'))
      .zcard(queue.toKey('delayed'))
      .llen(queue.toKey('active'))
      .zcard(queue.toKey('failed'))
      .zcard(queue.toKey('waiting-children'))
      .hexists(queue.toKey('meta'), 'paused')
      .lrange(queue.toKey('wait'), -QUEUE_AGE_SAMPLE_SIZE, -1)
      .zrange(queue.toKey('prioritized'), 0, QUEUE_AGE_SAMPLE_SIZE - 1)
      .exec()
    if (!replies || replies.length !== 9) throw new Error('Incomplete observation reply')

    const at = (index: number): [Error | null, unknown] =>
      replies[index] ?? [new Error('Missing observation reply'), undefined]
    const number = (index: number): number => {
      const [error, value] = at(index)
      if (error || typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error('Invalid observation count')
      }
      return value
    }
    const counts: AdminQueueCounts = {
      waiting: number(0),
      prioritized: number(1),
      delayed: number(2),
      active: number(3),
      failed: number(4),
      waitingChildren: number(5),
    }
    const paused = number(6) === 1
    const ids = [...new Set([...this.ids(at(7)), ...this.ids(at(8))])]
    const idsFailed = Boolean(at(7)[0] || at(8)[0])
    return { counts, paused, sampledAt: new Date().toISOString(), ids: idsFailed ? null : ids }
  }

  private ids([error, value]: [Error | null, unknown]): string[] {
    return !error && Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : []
  }

  /** Timestamp-only reads: payloads and any other job field never leave Redis. */
  private async readAge(
    queue: Queue,
    client: ObservationClient,
    ids: string[]
  ): Promise<AdminQueueAge | null> {
    const pipeline = client.pipeline()
    for (const id of ids) pipeline.hget(queue.toKey(id), 'timestamp')
    const replies = await pipeline.exec()
    if (!replies || replies.length !== ids.length) return null

    const now = Date.now()
    const stamps = replies
      .map(([error, value]) => (error ? NaN : Number(value)))
      .filter((stamp) => Number.isFinite(stamp) && stamp > 0 && stamp <= now)
    if (stamps.length === 0) return { status: 'unknown' }
    return {
      status: 'sample',
      seconds: Math.floor((now - Math.min(...stamps)) / 1000),
      sampled: stamps.length,
    }
  }
}
