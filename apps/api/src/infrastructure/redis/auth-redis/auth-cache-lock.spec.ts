import { ClientClosedError } from '@redis/client'
import type { PinoLogger } from 'nestjs-pino'

import { ServiceUnavailableException } from '../../../common/exceptions/index.js'

import { AuthCacheLock } from './auth-cache-lock.js'
import type { AuthRedis } from './auth-redis.service.js'

describe('AuthCacheLock', () => {
  let client: { set: jest.Mock; eval: jest.Mock }
  let call: jest.Mock
  let logger: { setContext: jest.Mock; warn: jest.Mock }
  let lock: AuthCacheLock

  beforeEach(() => {
    client = { set: jest.fn(), eval: jest.fn() }
    call = jest.fn((operation: (c: unknown) => unknown) => operation(client))
    logger = { setContext: jest.fn(), warn: jest.fn() }
    lock = new AuthCacheLock({ call } as unknown as AuthRedis, logger as unknown as PinoLogger)
  })

  it('returns an owner token when SET NX succeeds and passes the lease and deadline', async () => {
    client.set.mockResolvedValue('OK')
    const token = await lock.acquire('k', 5000, 120)
    expect(token).toEqual(expect.any(String))
    expect(client.set).toHaveBeenCalledWith('k', token, {
      expiration: { type: 'PX', value: 5000 },
      condition: 'NX',
    })
    expect(call).toHaveBeenCalledWith(expect.any(Function), 120)
  })

  it('returns null when another holder owns the key', async () => {
    client.set.mockResolvedValue(null)
    await expect(lock.acquire('k', 5000)).resolves.toBeNull()
  })

  it('surfaces the typed 503 from acquire instead of treating it as contention', async () => {
    const outage = new ServiceUnavailableException('Authentication temporarily unavailable')
    call.mockRejectedValue(outage)
    await expect(lock.acquire('k', 5000)).rejects.toBe(outage)
  })

  it('releases with a token-checked script under its own short deadline', async () => {
    client.eval.mockResolvedValue(1)
    await lock.release('k', 'token')
    expect(client.eval).toHaveBeenCalledWith(expect.stringContaining('GET'), {
      keys: ['k'],
      arguments: ['token'],
    })
    expect(call).toHaveBeenCalledWith(expect.any(Function), 250)
  })

  it('never throws from release: a failure only logs and the lease expires', async () => {
    call.mockRejectedValue(new ClientClosedError())
    await expect(lock.release('k', 'token')).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'k' }),
      expect.stringContaining('lease will expire')
    )
  })
})
