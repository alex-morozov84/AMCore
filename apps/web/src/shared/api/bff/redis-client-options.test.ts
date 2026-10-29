import { describe, expect, it, vi } from 'vitest'

import {
  createBffRedisClient,
  REDIS_KEEPALIVE_INITIAL_DELAY_MS,
  REDIS_QUEUE_TIMEOUT_MS,
  redisClientOptions,
} from './redis-client-options'

vi.mock('server-only', () => ({}))

describe('BFF redis client options', () => {
  it('fix the production contract in one place', () => {
    const options = redisClientOptions('redis://localhost:6379')

    expect(options.RESP).toBe(2)
    expect(options.commandOptions).toEqual({ timeout: 5000 })
    expect(options.socket.keepAliveInitialDelay).toBe(5000)
    expect(REDIS_QUEUE_TIMEOUT_MS).toBe(5000)
    expect(REDIS_KEEPALIVE_INITIAL_DELAY_MS).toBe(5000)
  })

  it('never set a global socket timeout', () => {
    expect(redisClientOptions('redis://localhost:6379').socket).not.toHaveProperty('socketTimeout')
  })

  it('resolve to RESP 2 with maintenance notifications disabled', () => {
    const client = createBffRedisClient('redis://127.0.0.1:1')

    expect(client.options?.RESP).toBe(2)
    expect(client.options?.commandOptions?.timeout).toBe(5000)
    expect(client.options?.maintNotifications).toBe('disabled')
  })
})
