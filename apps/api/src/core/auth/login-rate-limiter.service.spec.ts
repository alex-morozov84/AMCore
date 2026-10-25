import { LoginLimitConnection } from './login-limit-connection'
import { LoginRateLimiterService } from './login-rate-limiter.service'

// Command semantics/concurrency are proved against Redis in login-rate-limits.redis.e2e-spec.
describe('Login limiter failure boundary', () => {
  const run = jest.fn()
  let service: LoginRateLimiterService
  beforeEach(() => {
    jest.spyOn(LoginLimitConnection, 'acquire').mockReturnValue({ run } as never)
    run.mockReset().mockResolvedValue([1, 0])
    service = new LoginRateLimiterService({ get: () => 'redis://unused' } as never)
  })
  afterEach(() => jest.restoreAllMocks())
  it('uses the existing keys and one closed operation', async () => {
    await service.consume('a@example.test', '203.0.113.1')
    expect(run).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(String),
      [
        'rate:login_ip:203.0.113.1',
        'rate:login_user_ip:a@example.test:203.0.113.1',
        'rate:login_blocked:a@example.test:203.0.113.1',
      ],
      'consume'
    )
  })
  it.each([900, 86400])('preserves429 retry constant %s', async (seconds) => {
    run.mockResolvedValue([0, seconds])
    await expect(service.check('a', 'ip')).rejects.toMatchObject({
      status: 429,
      details: { retryAfterSeconds: seconds },
    })
  })
  it.each([[-1, 0], [0, 900], null, [1, 0, 0], ['1', 0]])(
    'fails closed on invalid consume result %p',
    async (reply) => {
      run.mockResolvedValue(reply)
      await expect(service.consume('a', 'ip')).rejects.toMatchObject({
        status: 503,
        errorCode: 'SERVICE_UNAVAILABLE',
      })
      expect(run).toHaveBeenCalledTimes(1)
    }
  )
  it('does not retry an unknown dispatched outcome', async () => {
    run.mockRejectedValue(new Error('secret redis address'))
    await expect(service.reset('a', 'ip')).rejects.toMatchObject({
      status: 503,
      message: 'Login protection temporarily unavailable',
    })
    expect(run).toHaveBeenCalledTimes(1)
  })
})
