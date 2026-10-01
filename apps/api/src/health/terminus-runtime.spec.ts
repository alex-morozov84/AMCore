import { ServiceUnavailableException } from '@nestjs/common'
import { HealthCheckService, HealthIndicatorService, TerminusModule } from '@nestjs/terminus'
import { Test, type TestingModule } from '@nestjs/testing'

describe('installed Terminus runtime', () => {
  let module: TestingModule
  let health: HealthCheckService
  let indicator: HealthIndicatorService

  beforeEach(async () => {
    module = await Test.createTestingModule({ imports: [TerminusModule] }).compile()
    await module.init()
    health = module.get(HealthCheckService)
    indicator = module.get(HealthIndicatorService)
  })

  afterEach(async () => {
    await module.close()
  })

  it('keeps a fulfilled degraded check observable', async () => {
    const result = await health.check([() => indicator.check('redis').degraded()])
    expect(result.status).toBe('degraded')
    expect(result.details.redis.status).toBe('degraded')
  })

  it('returns a 503 result for an expected down check', async () => {
    await expect(health.check([() => indicator.check('redis').down()])).rejects.toBeInstanceOf(
      ServiceUnavailableException
    )
  })

  it('propagates an unexpected provider exception', async () => {
    const error = new Error('unexpected provider fault')
    await expect(
      health.check([
        () => {
          throw error
        },
      ])
    ).rejects.toBe(error)
  })

  it('reports shutting_down after the real Nest lifecycle hook', async () => {
    await module.close()
    await expect(health.check([() => indicator.check('redis').up()])).rejects.toMatchObject({
      status: 503,
      response: { status: 'shutting_down' },
    })
  })
})
