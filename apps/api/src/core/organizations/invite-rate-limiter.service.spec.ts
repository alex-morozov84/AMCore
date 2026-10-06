import { InviteRateLimiterService } from './invite-rate-limiter.service'

function setup(result: unknown = 1) {
  const redis = { eval: jest.fn(async () => result) }
  return { redis, service: new InviteRateLimiterService(redis as never) }
}

describe('atomic invitation issuance allowance', () => {
  it('uses one decision for both budgets with no plaintext email key', async () => {
    const { service, redis } = setup()
    await service.consume('org', 'recipient@example.test', 'actor')
    expect(redis.eval).toHaveBeenCalledTimes(1)
    const [script, input] = redis.eval.mock.calls[0] as unknown as [string, { keys: string[]; arguments: string[] }]
    expect(script).toContain('pair >= 3 or actor >= 30')
    expect(input.keys).toHaveLength(2)
    expect(JSON.stringify(input)).not.toContain('recipient@example.test')
    expect(input.arguments).toEqual(['3600000'])
  })
  it('returns a bounded Retry-After on exhausted allowance', async () => {
    const { service } = setup(0)
    await expect(service.consume('org', 'recipient@example.test', 'actor')).rejects.toMatchObject({
      errorCode: 'RATE_LIMIT_EXCEEDED', details: { retryAfterSeconds: 3600 },
    })
  })
  it('does not silently admit during Redis failure', async () => {
    const { service, redis } = setup()
    redis.eval.mockRejectedValue(new Error('unavailable'))
    await expect(service.consume('org', 'recipient@example.test', 'actor')).rejects.toThrow('unavailable')
  })
})
