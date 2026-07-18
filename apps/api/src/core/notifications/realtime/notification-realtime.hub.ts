import { Injectable, type OnModuleDestroy } from '@nestjs/common'

import type { NotificationSseEvent } from '@amcore/shared'

import {
  NotificationStreamConnection,
  type StreamCloseReason,
  type StreamWritable,
} from './notification-stream.connection'

import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'

/** Admission verdict before any SSE headers are flushed. */
export type AdmissionResult =
  { ok: true; connection: NotificationStreamConnection } | { ok: false; reason: 'global' | 'user' }

/**
 * Process-local registry of open SSE streams (ADR-053), web/all role only. Holds
 * connection state, not correctness state — a notification is durable in Postgres
 * regardless. Enforces a global per-process cap (replica protection) and a per-user
 * cap, routes a hint to a user's local streams, and runs a single heartbeat
 * scheduler for every connection. All register/unregister paths are idempotent and
 * keep the active-connections gauge balanced exactly once.
 */
@Injectable()
export class NotificationRealtimeHub implements OnModuleDestroy {
  private readonly byUser = new Map<string, Set<NotificationStreamConnection>>()
  private total = 0
  private heartbeatTimer?: ReturnType<typeof setInterval>
  private readonly maxConnections: number
  private readonly maxPerUser: number
  private readonly heartbeatMs: number

  constructor(
    private readonly env: EnvService,
    private readonly metrics: MetricsService
  ) {
    this.maxConnections = this.env.get('NOTIFICATIONS_REALTIME_MAX_CONNECTIONS')
    this.maxPerUser = this.env.get('NOTIFICATIONS_REALTIME_MAX_PER_USER')
    this.heartbeatMs = this.env.get('NOTIFICATIONS_REALTIME_HEARTBEAT_MS')
  }

  /**
   * Atomically check admission (global cap → per-user cap) and, if allowed, create
   * and register the connection. The caller flushes headers and calls `open()` only
   * on `ok` — the connection writes nothing until then.
   */
  register(res: StreamWritable, userId: string, lifetimeMs: number): AdmissionResult {
    if (this.total >= this.maxConnections) return { ok: false, reason: 'global' }
    const existing = this.byUser.get(userId)
    if (existing && existing.size >= this.maxPerUser) return { ok: false, reason: 'user' }

    const connection = new NotificationStreamConnection(res, userId, {
      queueDepth: this.env.get('NOTIFICATIONS_REALTIME_QUEUE_DEPTH'),
      lifetimeMs,
      onClose: (reason) => this.unregister(connection, reason),
    })
    if (existing) existing.add(connection)
    else this.byUser.set(userId, new Set([connection]))
    this.total += 1
    this.metrics.incNotificationRealtimeConnections()
    this.ensureHeartbeat()
    return { ok: true, connection }
  }

  /** Deliver a hint to every local stream of `userId`; returns how many received it. */
  routeToUser(userId: string, event: NotificationSseEvent): number {
    const set = this.byUser.get(userId)
    if (!set) return 0
    for (const connection of set) connection.sendData(event)
    return set.size
  }

  onModuleDestroy(): void {
    this.closeAll()
  }

  /** Close every stream (graceful) — used on shutdown drain (ADR-041). */
  closeAll(): void {
    for (const set of [...this.byUser.values()]) {
      for (const connection of [...set]) connection.close('shutdown')
    }
    this.stopHeartbeat()
  }

  private unregister(connection: NotificationStreamConnection, reason: StreamCloseReason): void {
    const set = this.byUser.get(connection.userId)
    if (!set || !set.has(connection)) return // idempotent: balance the gauge once
    set.delete(connection)
    if (set.size === 0) this.byUser.delete(connection.userId)
    this.total -= 1
    this.metrics.decNotificationRealtimeConnections()
    if (reason === 'overflow') this.metrics.incNotificationRealtimeEvent('slow_close')
    if (this.total === 0) this.stopHeartbeat()
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => this.beat(), this.heartbeatMs)
    // Don't let the keepalive timer hold the process (or Jest) open.
    this.heartbeatTimer.unref?.()
  }

  private beat(): void {
    for (const set of this.byUser.values()) {
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
