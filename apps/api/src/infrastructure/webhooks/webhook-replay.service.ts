import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import {
  WEBHOOK_DEGRADE_LOG_INTERVAL_MS,
  WEBHOOK_REDIS_KEY_PREFIX,
  WEBHOOK_REDIS_TIMEOUT_MS,
} from './webhook.constants'

import { REDIS_CLIENT } from '@/infrastructure/redis/redis.constants'
import type { AppRedisClient } from '@/infrastructure/redis/redis-connection.service'

@Injectable()
export class WebhookReplayService {
  private lastDegradeLogAt = 0

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(WebhookReplayService.name)
  }

  async checkAndMark(
    provider: string,
    eventId: string | undefined,
    ttlSeconds: number
  ): Promise<boolean> {
    if (!eventId) return true

    try {
      return await withTimeout(markFirst(this.redis, provider, eventId, ttlSeconds))
    } catch {
      this.logDegraded(provider)
      return true
    }
  }

  private logDegraded(provider: string): void {
    const now = Date.now()
    if (now - this.lastDegradeLogAt < WEBHOOK_DEGRADE_LOG_INTERVAL_MS) return
    this.lastDegradeLogAt = now
    this.logger.warn({ provider }, 'Webhook replay dedupe unavailable; continuing without Redis')
  }
}

async function markFirst(
  redis: AppRedisClient,
  provider: string,
  eventId: string,
  ttlSeconds: number
): Promise<boolean> {
  const reply = await redis.set(`${WEBHOOK_REDIS_KEY_PREFIX}${provider}:${eventId}`, '1', {
    condition: 'NX',
    expiration: { type: 'EX', value: ttlSeconds },
  })
  return reply === 'OK'
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('webhook replay timeout')), WEBHOOK_REDIS_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
