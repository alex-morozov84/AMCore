import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'
import { Pool } from 'pg'

import type { Env } from '../env'
import { EnvService } from '../env/env.service'

type SlowQueryEvent = {
  query: string
  duration: number
  params?: string
}

export function resolveSlowQueryThresholdMs(
  nodeEnv: Env['NODE_ENV'],
  configuredThresholdMs: number
): number {
  return configuredThresholdMs ?? (nodeEnv === 'production' ? 500 : 100)
}

export function logSlowQuery(
  event: SlowQueryEvent,
  thresholdMs: number,
  logger: Pick<PinoLogger, 'warn'>
): void {
  if (event.duration <= thresholdMs) {
    return
  }

  logger.warn(
    {
      query: event.query,
      duration: event.duration,
    },
    'slow query'
  )
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    env: EnvService,
    private readonly logger: PinoLogger
  ) {
    const pool = new Pool({
      connectionString: env.get('DATABASE_URL'),
      max: env.get('DATABASE_POOL_MAX'),
      idleTimeoutMillis: env.get('DATABASE_POOL_IDLE_MS'),
      connectionTimeoutMillis: env.get('DATABASE_CONNECT_MS'),
      statement_timeout: env.get('DATABASE_STATEMENT_TIMEOUT_MS'),
      query_timeout: env.get('DATABASE_QUERY_TIMEOUT_MS'),
      application_name: 'amcore-api',
    })
    const adapter = new PrismaPg(pool)
    const slowQueryThresholdMs = resolveSlowQueryThresholdMs(
      env.get('NODE_ENV'),
      env.get('SLOW_QUERY_THRESHOLD_MS')
    )

    super({
      adapter,
      log: [{ emit: 'event', level: 'query' }],
    })

    this.logger.setContext(PrismaService.name)
    const onQuery = this.$on as (
      eventType: 'query',
      listener: (event: SlowQueryEvent) => void
    ) => void

    onQuery('query', (event) => {
      logSlowQuery(event, slowQueryThresholdMs, this.logger)
    })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
