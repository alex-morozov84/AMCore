import {
  createAppRedisClient,
  REDIS_KEEPALIVE_INITIAL_DELAY_MS,
  REDIS_QUEUE_TIMEOUT_MS,
  redisClientOptions,
} from './redis-client-options'

describe('redis client options', () => {
  it('fix the production contract in one place', () => {
    const options = redisClientOptions('redis://localhost:6379')

    expect(options.RESP).toBe(2)
    expect(options.commandOptions).toEqual({ timeout: 5000 })
    expect(options.socket.keepAliveInitialDelay).toBe(5000)
    expect(REDIS_QUEUE_TIMEOUT_MS).toBe(5000)
    expect(REDIS_KEEPALIVE_INITIAL_DELAY_MS).toBe(5000)
  })

  it('never set a global socket timeout, which would disconnect idle subscribers', () => {
    expect(redisClientOptions('redis://localhost:6379').socket).not.toHaveProperty('socketTimeout')
  })

  it('back off by 50 ms per retry up to 2 s', () => {
    const { reconnectStrategy } = redisClientOptions('redis://localhost:6379').socket

    expect(
      typeof reconnectStrategy === 'function' && [0, 10, 40, 400].map(reconnectStrategy)
    ).toEqual([0, 500, 2000, 2000])
  })

  it('resolve to RESP 2 with maintenance notifications disabled on the client and its duplicate', () => {
    const client = createAppRedisClient('redis://127.0.0.1:1')

    for (const resolved of [client, client.duplicate()]) {
      expect(resolved.options?.RESP).toBe(2)
      expect(resolved.options?.commandOptions?.timeout).toBe(5000)
      expect(resolved.options?.maintNotifications).toBe('disabled')
      expect(resolved.options?.socket).toMatchObject({ keepAliveInitialDelay: 5000 })
    }
  })
})
