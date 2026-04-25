import type { AppRedisClient } from './index'
import { RedisLockService } from './redis-lock.service'

describe('RedisLockService', () => {
  let service: RedisLockService
  let redis: jest.Mocked<Pick<AppRedisClient, 'set' | 'eval'>>

  beforeEach(() => {
    redis = {
      set: jest.fn(),
      eval: jest.fn(),
    } as jest.Mocked<Pick<AppRedisClient, 'set' | 'eval'>>

    service = new RedisLockService(redis as unknown as AppRedisClient)
  })

  it('should acquire lock with SET PX NX and return token', async () => {
    redis.set.mockResolvedValueOnce('OK')

    const token = await service.acquire('lock:key', 5000)

    expect(token).toEqual(expect.any(String))
    expect(redis.set).toHaveBeenCalledWith('lock:key', token, {
      expiration: { type: 'PX', value: 5000 },
      condition: 'NX',
    })
  })

  it('should return null when lock is already held', async () => {
    redis.set.mockResolvedValueOnce(null)

    const token = await service.acquire('lock:key', 5000)

    expect(token).toBeNull()
  })

  it('should release lock through token-checked Lua script', async () => {
    redis.eval.mockResolvedValueOnce(1)

    await service.release('lock:key', 'lock-token')

    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('redis.call("GET", KEYS[1])'), {
      keys: ['lock:key'],
      arguments: ['lock-token'],
    })
  })
})
