import { sanitizeHeaders } from './sanitize-headers'

describe('sanitizeHeaders', () => {
  it('returns an empty object for undefined / null input', () => {
    expect(sanitizeHeaders(undefined)).toEqual({})
    expect(sanitizeHeaders(null)).toEqual({})
  })

  it('preserves non-sensitive headers as-is', () => {
    const headers = {
      host: 'example.com',
      'user-agent': 'jest',
      'content-type': 'application/json',
      'x-correlation-id': 'abc-123',
    }
    expect(sanitizeHeaders(headers)).toEqual(headers)
  })

  it('redacts every sensitive header (lowercase keys)', () => {
    const result = sanitizeHeaders({
      authorization: 'Bearer secret-token',
      'proxy-authorization': 'Bearer proxy-secret',
      cookie: 'refresh_token=secret',
      'set-cookie': 'session=secret',
      'x-api-key': 'amcore_live_x_y',
      'x-auth-token': 'leaked',
      'stripe-signature': 't=1,v1=abc',
      'x-telegram-bot-api-secret-token': 'tg-secret',
      'x-amcore-operator-reason': 'ticket-SUP-42',
    })
    expect(result).toEqual({
      authorization: '[REDACTED]',
      'proxy-authorization': '[REDACTED]',
      cookie: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      'x-api-key': '[REDACTED]',
      'x-auth-token': '[REDACTED]',
      'stripe-signature': '[REDACTED]',
      'x-telegram-bot-api-secret-token': '[REDACTED]',
      'x-amcore-operator-reason': '[REDACTED]',
    })
  })

  it('matches sensitive header names case-insensitively', () => {
    const result = sanitizeHeaders({
      Authorization: 'Bearer secret',
      Cookie: 'refresh_token=secret',
      'X-Api-Key': 'k',
    })
    expect(result).toEqual({
      Authorization: '[REDACTED]',
      Cookie: '[REDACTED]',
      'X-Api-Key': '[REDACTED]',
    })
  })

  it('redacts array header values (e.g. set-cookie)', () => {
    const result = sanitizeHeaders({
      'set-cookie': ['session=secret-a', 'refresh=secret-b'],
      host: 'example.com',
    })
    expect(result).toEqual({
      'set-cookie': '[REDACTED]',
      host: 'example.com',
    })
  })

  it('returns a new object and does not mutate the input', () => {
    const input = { authorization: 'Bearer secret', host: 'example.com' }
    const result = sanitizeHeaders(input)
    expect(result).not.toBe(input)
    expect(input.authorization).toBe('Bearer secret')
  })

  it('does not redact lookalikes that are not in the sensitive set', () => {
    const result = sanitizeHeaders({
      'x-custom-auth-header': 'safe-value',
      authorize: 'safe-value',
    })
    expect(result).toEqual({
      'x-custom-auth-header': 'safe-value',
      authorize: 'safe-value',
    })
  })
})
