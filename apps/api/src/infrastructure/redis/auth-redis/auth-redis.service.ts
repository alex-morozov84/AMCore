import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import { createClient } from '@redis/client'
import { PinoLogger } from 'nestjs-pino'

import { EnvService } from '../../../env/env.service.js'
import { MetricsService } from '../../observability/index.js'
import type { BoundedRedisClient } from '../bounded-redis.js'
import { type AppRedisClient, redisClientOptions } from '../redis-client-options.js'

import { AUTH_REDIS_DEFAULTS, type AuthRedisEvent } from './auth-redis.constants.js'
import { type AuthRedisStats, AuthRedisSupervisor } from './auth-redis-supervisor.js'

/** Longest the module waits for the first connection before serving fast 503s. */
const STARTUP_WAIT_MS = 1500
const STARTUP_POLL_MS = 25

/**
 * Dedicated, supervised Redis client for the authentication path: user-adjacent caches,
 * their locks, OAuth state and tickets, and the abuse counters. It is separate from the
 * shared client so a stalled connection here is replaced within seconds while job, subscriber
 * and health connections keep their own lifecycles.
 *
 * Every call has the `BoundedRedis` contract: a typed error at the deadline, a slot held
 * until the operation settles, nothing retried. The dependency health probe stays on the
 * shared client; this client's state is an alertable signal, not a readiness gate.
 */
@Injectable()
export class AuthRedis implements OnModuleInit, OnApplicationShutdown {
  private readonly supervisor: AuthRedisSupervisor

  constructor(
    private readonly env: EnvService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService
  ) {
    this.logger.setContext(AuthRedis.name)
    this.supervisor = new AuthRedisSupervisor(
      () => this.newClient(),
      (event) => this.observe(event)
    )
  }

  async onModuleInit(): Promise<void> {
    this.supervisor.start()
    const deadline = Date.now() + STARTUP_WAIT_MS
    while (!this.supervisor.ready && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, STARTUP_POLL_MS))
    if (!this.supervisor.ready)
      this.logger.warn('Auth Redis client not ready at startup; requests answer 503 until it is')
  }

  onApplicationShutdown(): void {
    this.supervisor.stop()
  }

  run<T>(
    operation: (client: BoundedRedisClient, signal: AbortSignal) => Promise<T>,
    deadlineMs?: number
  ): Promise<T> {
    return this.supervisor.run(operation, deadlineMs)
  }

  get ready(): boolean {
    return this.supervisor.ready
  }

  stats(): AuthRedisStats {
    return this.supervisor.stats()
  }

  /** Overridable in tests; production always builds a client with the shared contract. */
  protected newClient(): AppRedisClient {
    const base = redisClientOptions(this.env.get('REDIS_URL'))
    return createClient({
      ...base,
      socket: { ...base.socket, connectTimeout: AUTH_REDIS_DEFAULTS.connectTimeoutMs },
    })
  }

  private observe(event: AuthRedisEvent): void {
    if (event.kind === 'client-error') {
      this.metrics.incRedisClientEvent('auth', 'error')
      this.logger.error(
        { err: event.error, generation: event.generation },
        'Auth Redis client error'
      )
    } else if (event.kind === 'reconnecting') {
      this.metrics.incRedisClientEvent('auth', 'reconnecting')
    } else if (event.kind === 'replaced') {
      this.metrics.incRedisClientEvent('auth', 'degraded')
      this.logger.warn(
        { generation: event.generation, reason: event.reason },
        'Auth Redis client generation replaced'
      )
    } else {
      this.metrics.incRedisClientEvent('auth', 'degraded')
      this.logger.error({ generation: event.generation, alert: event.alert }, 'Auth Redis alert')
    }
  }
}
