import { directSecretResult } from './direct-secret-result.js'

describe('direct secret evidence', () => {
  it('requires a completed transport admission and a bounded acknowledgement', () => {
    const accepted = { id: 'fake-ack', success: true }
    expect(directSecretResult(accepted, false, false)).toEqual({
      outcome: 'not_started',
      reason: 'precheck',
    })
    expect(directSecretResult(accepted, false, true).outcome).toBe('accepted')
    expect(directSecretResult(accepted, true, true).outcome).toBe('simulated')
    for (const id of ['', 'x'.repeat(129), 'https://example.test/?token=<fake>']) {
      expect(directSecretResult({ id, success: true }, false, true).outcome).toBe('unknown')
    }
  })

  it.each([
    'rate_limit_exceeded',
    'invalid_api_key',
    'validation_error',
    '<private-provider-text>',
  ])('does not infer no effect from parsed SDK errors: %s', (error) => {
    const result = directSecretResult({ id: '', success: false, error }, false, true)
    expect(result.outcome).toBe('unknown')
    expect(JSON.stringify(result)).not.toContain('<private-provider-text>')
  })
})
