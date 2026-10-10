import { Injectable } from '@nestjs/common'
import Redis, { type RedisOptions } from 'ioredis'

import { buildBullConnection } from '../queue/redis-connection.config'

import { CONTROL_LIMITS } from './control-limits'

import { AppException } from '@/common/exceptions'
import { EnvService } from '@/env/env.service'

/** Mutations must never inherit producer reconnect, offline buffering or automatic resends. */
export function controlConnectionOptions(redisUrl: string): RedisOptions {
  return {
    ...buildBullConnection(redisUrl),
    lazyConnect: true,
    enableOfflineQueue: false,
    autoResendUnfulfilledCommands: false,
    autoResubscribe: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    reconnectOnError: () => false,
    connectTimeout: CONTROL_LIMITS.redisDeadlineMs,
    commandTimeout: CONTROL_LIMITS.redisDeadlineMs,
  }
}

@Injectable()
export class ControlConnection {
  // Shared across module-local providers as well as the generated runtime provider.
  private static leases = 0
  constructor(private readonly env: EnvService) {}

  /** One lease, one connection attempt. The ledger decides whether a command was dispatched. */
  async withClient<T>(action: (client: Redis) => Promise<T>): Promise<T> {
    if (ControlConnection.leases >= CONTROL_LIMITS.concurrentDispatches)
      throw new AppException('Control connection capacity reached', 503, 'WORK_UNAVAILABLE')
    ControlConnection.leases += 1
    let client: Redis | undefined
    try {
      client = new Redis(controlConnectionOptions(this.env.get('REDIS_URL')))
      // Connection errors also reject connect()/commands. Do not log credentials or transport text.
      client.on('error', () => undefined)
      await client.connect()
      return await action(client)
    } finally {
      client?.disconnect(false)
      ControlConnection.leases -= 1
    }
  }
}
