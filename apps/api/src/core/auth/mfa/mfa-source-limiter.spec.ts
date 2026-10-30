import { LoginLimitConnection } from '../login-limit-connection.js'

import { mfaHash } from './mfa-secrets.js'
import { MfaSourceLimiterService } from './mfa-source-limiter.service.js'

describe('MFA source limiter failure boundary', () => {
  const run = jest.fn()
  const stop = jest.fn(async () => undefined)
  let service: MfaSourceLimiterService
  beforeEach(() => {
    jest.spyOn(LoginLimitConnection, 'acquire').mockReturnValue({ run, stop } as never)
    run.mockReset().mockResolvedValue([1, 0])
    stop.mockClear()
    service = new MfaSourceLimiterService({ get: () => 'redis://unused' } as never)
  })
  afterEach(() => jest.restoreAllMocks())

  it('charges a hashed source independently of actor, flow and audience', async () => {
    await service.consume('verify', '203.0.113.9')
    expect(run).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(String),
      [`rate:mfa_source:v1:verify:${mfaHash('203.0.113.9')}`],
      expect.stringMatching(/^verify:[a-f0-9-]{36}$/)
    )
  })

  it('reports a limited source separately from an infrastructure failure', async () => {
    run.mockResolvedValue([0, 899])
    await expect(service.consume('verify', 'source')).rejects.toMatchObject({
      status: 429,
      details: { retryAfterSeconds: 899 },
    })
  })

  it.each([[-1, 0], [0, 0], [0, 0.5], ['1', 0], null, [1, 0, 0]])(
    'fails closed without retry on malformed reply %j',
    async (reply) => {
      run.mockResolvedValue(reply)
      await expect(service.consume('start', 'source')).rejects.toMatchObject({ status: 503 })
      expect(run).toHaveBeenCalledTimes(1)
    }
  )

  it('does not retry an unknown dispatched result or expose Redis connection errors', async () => {
    run.mockRejectedValue(new Error('fake-private-redis-address'))
    await expect(service.consume('verify', 'source')).rejects.toMatchObject({
      status: 503,
      message: 'MFA protection temporarily unavailable',
    })
    expect(run).toHaveBeenCalledTimes(1)
    await service.onModuleDestroy()
    await expect(service.consume('verify', 'source')).rejects.toMatchObject({ status: 503 })
    expect(run).toHaveBeenCalledTimes(1)
  })
})
