import { parseRetryAfterMs } from './retry-after'

describe('parseRetryAfterMs', () => {
  const now = new Date('2026-10-05T12:00:00.000Z')

  it('parses delta-seconds (ASCII digits only, up to 10)', () => {
    expect(parseRetryAfterMs('120', now)).toBe(120_000)
    expect(parseRetryAfterMs(' 7 ', now)).toBe(7_000)
    expect(parseRetryAfterMs('9999999999', now)).toBe(9_999_999_999_000)
  })

  it('treats zero as "no signal" (ordinary backoff)', () => {
    expect(parseRetryAfterMs('0', now)).toBeUndefined()
  })

  it.each(['', ' ', '-5', '1.5', '1e3', '0x10', '12abc', 'soon', '99999999999', '١٢٣'])(
    'treats %j as unsupported → no signal (never throws)',
    (value) => {
      expect(parseRetryAfterMs(value, now)).toBeUndefined()
    }
  )

  it('parses a strict IMF-fixdate relative to the response-received time', () => {
    expect(parseRetryAfterMs('Mon, 05 Oct 2026 12:02:00 GMT', now)).toBe(120_000)
  })

  it('treats a past or equal HTTP-date as no signal', () => {
    expect(parseRetryAfterMs('Mon, 05 Oct 2026 12:00:00 GMT', now)).toBeUndefined()
    expect(parseRetryAfterMs('Mon, 05 Oct 2026 11:00:00 GMT', now)).toBeUndefined()
  })

  it.each([
    '2026-10-05T12:05:00Z', // ISO is not an HTTP-date
    'Monday, 05-Oct-26 12:05:00 GMT', // obsolete RFC 850 form is not accepted
    'Mon, 5 Oct 2026 12:05:00 GMT', // single-digit day
    'Mon, 05 Oct 2026 12:05:00 UTC',
  ])('rejects the non-IMF date form %j', (value) => {
    expect(parseRetryAfterMs(value, now)).toBeUndefined()
  })

  it('returns undefined for a missing header', () => {
    expect(parseRetryAfterMs(undefined, now)).toBeUndefined()
    expect(parseRetryAfterMs(null, now)).toBeUndefined()
  })
})
