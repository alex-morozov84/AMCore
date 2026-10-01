import { observabilityEnv } from './observability.env'

describe('Overview operational environment', () => {
  it('treats empty optional values as absent without losing distinct heap defaults', () => {
    const result = observabilityEnv.parse({
      APP_ENVIRONMENT: '',
      APP_DEPLOYMENT_ID: '',
      HEALTH_MEMORY_HEAP_BYTES: '',
    })
    expect(result.APP_ENVIRONMENT).toBeUndefined()
    expect(result.APP_DEPLOYMENT_ID).toBeUndefined()
    expect(result.HEALTH_MEMORY_HEAP_BYTES).toBeUndefined()
    expect(result.APP_VERSION).toBe('unknown')
  })

  it('accepts bounded deployment labels and configured thresholds', () => {
    const result = observabilityEnv.parse({
      APP_ENVIRONMENT: 'staging.eu-1',
      APP_DEPLOYMENT_ID: 'api-rollout_1',
      HEALTH_MEMORY_HEAP_BYTES: '12345',
    })
    expect(result.APP_ENVIRONMENT).toBe('staging.eu-1')
    expect(result.APP_DEPLOYMENT_ID).toBe('api-rollout_1')
    expect(result.HEALTH_MEMORY_HEAP_BYTES).toBe(12345)
  })

  it.each(['https://host.example', 'x'.repeat(65), 'production secret'])(
    'rejects invalid environment label %p',
    (APP_ENVIRONMENT) => {
      expect(observabilityEnv.safeParse({ APP_ENVIRONMENT }).success).toBe(false)
    }
  )
})
