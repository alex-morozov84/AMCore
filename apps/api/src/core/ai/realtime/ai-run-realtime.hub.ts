import { Injectable, type OnModuleDestroy } from '@nestjs/common'

import type { AiRunSseEvent } from '@amcore/shared'

import {
  AiRunStreamConnection,
  type StreamCloseReason,
  type StreamWritable,
} from './ai-run-stream.connection'

import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'

/** Admission verdict before any SSE headers are flushed. */
export type AdmissionResult =
  { ok: true; connection: AiRunStreamConnection } | { ok: false; reason: 'global' | 'user' }

/**
 * Process-local registry of open AI run-status SSE streams (Track C — ADR-054, Arc C.5; ADR-053
 * pattern), web/all role only. Holds connection state, not correctness state — a run's status is
 * durable in Postgres regardless. Streams are indexed by **`runId`** for routing (a stream watches
 * exactly one run) and counted by **owner `userId`** for the per-user cap; a global per-process cap
 * protects the replica. All register/unregister paths are idempotent and keep the active-connections
 * gauge and per-user counts balanced exactly once. One heartbeat scheduler serves every connection.
 */
@Injectable()
export class AiRunRealtimeHub implements OnModuleDestroy {
  private readonly byRun = new Map<string, Set<AiRunStreamConnection>>()
  private readonly userCounts = new Map<string, number>()
  private total = 0
  private heartbeatTimer?: ReturnType<typeof setInterval>
  private readonly maxConnections: number
  private readonly maxPerUser: number
  private readonly heartbeatMs: number

  constructor(
    private readonly env: EnvService,
    private readonly metrics: MetricsService
  ) {
    this.maxConnections = this.env.get('AI_REALTIME_MAX_CONNECTIONS')
    this.maxPerUser = this.env.get('AI_REALTIME_MAX_PER_USER')
    this.heartbeatMs = this.env.get('AI_REALTIME_HEARTBEAT_MS')
  }

  /**
   * Atomically check admission (global cap → per-user cap) and, if allowed, create and register the
   * connection for `(userId, runId)`. The caller flushes headers and calls `open()` only on `ok` —
   * the connection writes nothing until then.
   */
  register(
    res: StreamWritable,
    userId: string,
    runId: string,
    lifetimeMs: number
  ): AdmissionResult {
    if (this.total >= this.maxConnections) return { ok: false, reason: 'global' }
    if ((this.userCounts.get(userId) ?? 0) >= this.maxPerUser) return { ok: false, reason: 'user' }

    const connection = new AiRunStreamConnection(res, userId, runId, {
      queueDepth: this.env.get('AI_REALTIME_QUEUE_DEPTH'),
      lifetimeMs,
      onClose: (reason) => this.unregister(connection, reason),
    })
    const runSet = this.byRun.get(runId)
    if (runSet) runSet.add(connection)
    else this.byRun.set(runId, new Set([connection]))
    this.userCounts.set(userId, (this.userCounts.get(userId) ?? 0) + 1)
    this.total += 1
    this.metrics.incAiRunRealtimeConnections()
    this.ensureHeartbeat()
    return { ok: true, connection }
  }

  /**
   * Deliver a hint to every local stream of `runId` owned by `recipientUserId`; returns how many
   * received it. The owner match is defence-in-depth — a stream is only ever admitted for the run's
   * owner — so a routing envelope can never fan out to another account's stream.
   */
  routeToRun(runId: string, recipientUserId: string, event: AiRunSseEvent): number {
    const set = this.byRun.get(runId)
    if (!set) return 0
    let delivered = 0
    for (const connection of set) {
      if (connection.userId !== recipientUserId) continue
      connection.sendData(event)
      delivered += 1
    }
    return delivered
  }

  onModuleDestroy(): void {
    this.closeAll()
  }

  /** Close every stream (graceful) — used on shutdown drain (ADR-041). */
  closeAll(): void {
    for (const set of [...this.byRun.values()]) {
      for (const connection of [...set]) connection.close('shutdown')
    }
    this.stopHeartbeat()
  }

  private unregister(connection: AiRunStreamConnection, reason: StreamCloseReason): void {
    const set = this.byRun.get(connection.runId)
    if (!set || !set.has(connection)) return // idempotent: balance the gauge once
    set.delete(connection)
    if (set.size === 0) this.byRun.delete(connection.runId)
    const nextCount = (this.userCounts.get(connection.userId) ?? 1) - 1
    if (nextCount <= 0) this.userCounts.delete(connection.userId)
    else this.userCounts.set(connection.userId, nextCount)
    this.total -= 1
    this.metrics.decAiRunRealtimeConnections()
    if (reason === 'overflow') this.metrics.incAiRunRealtimeEvent('slow_close')
    if (this.total === 0) this.stopHeartbeat()
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => this.beat(), this.heartbeatMs)
    // Don't let the keepalive timer hold the process (or Jest) open.
    this.heartbeatTimer.unref?.()
  }

  private beat(): void {
    for (const set of this.byRun.values()) {
      for (const connection of set) connection.heartbeat()
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }
}
