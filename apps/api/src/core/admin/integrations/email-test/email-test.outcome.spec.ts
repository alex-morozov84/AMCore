import { classifySend } from './email-test.outcome.js'

describe('classifySend', () => {
  it('accepts only a real provider success with an id', () => {
    expect(classifySend('resend', { success: true, id: 'abc' })).toEqual({
      outcome: 'accepted',
      class: null,
    })
    expect(classifySend('resend', { success: true, id: '' })).toEqual({
      outcome: 'unknown',
      class: null,
    })
  })

  it('never reports the mock provider as accepted', () => {
    expect(classifySend('mock', { success: true, id: 'mock-1' }).outcome).toBe('simulated')
  })

  it.each([
    ['restricted_api_key', 'auth'],
    ['invalid_from_address', 'invalid_sender'],
    ['validation_error', 'invalid_request'],
  ])('refuses %s as %s', (error, probeClass) => {
    expect(classifySend('resend', { success: false, id: '', error })).toEqual({
      outcome: 'refused',
      class: probeClass,
    })
  })

  it.each([
    ['rate_limit_exceeded', 'rate_limit'],
    ['daily_quota_exceeded', 'quota'],
    ['monthly_quota_exceeded', 'quota'],
  ])('keeps %s unknown with a safe class', (error, probeClass) => {
    expect(classifySend('resend', { success: false, id: '', error })).toEqual({
      outcome: 'unknown',
      class: probeClass,
    })
  })

  it('keeps provider_failure and unrecognised errors unknown', () => {
    expect(
      classifySend('resend', { success: false, id: '', error: 'provider_failure' }).outcome
    ).toBe('unknown')
    expect(classifySend('resend', { success: false, id: '', error: 'something new' }).outcome).toBe(
      'unknown'
    )
  })
})
