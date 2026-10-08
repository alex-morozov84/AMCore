import { parseProviderRetryHint, retryDateAtPgClock } from './provider-retry-hint'

describe('provider retry hint grammar', () => {
  it.each([
    ['0', 0],
    ['000000001', 1],
    ['86400', 86400],
    ['86401', 86401],
    ['2147483647', 2147483647],
  ] as const)('retains duration %s without a clamp', (raw, seconds) => {
    expect(parseProviderRetryHint(raw)).toEqual({ kind: 'relative', seconds })
  })
  it.each(['2147483648', '9'.repeat(8000)])('keeps overflow as unknown, never absent', (raw) => {
    expect(parseProviderRetryHint(raw)).toEqual({ kind: 'unknown', reason: 'overflow' })
  })
  it('bounds scan and rejects malformed dates/durations without Date.parse fallback', () => {
    expect(parseProviderRetryHint('9'.repeat(8193))).toMatchObject({ kind: 'unknown' })
    for (const raw of [
      '-1',
      '1.2',
      'tomorrow',
      'Mon, 31 Feb 2026 12:00:00 GMT',
      'Wed, 07 Oct 2026 25:00:00 GMT',
    ])
      expect(parseProviderRetryHint(raw)).toBeUndefined()
  })
  it.each([
    'Wed, 07 Oct 2026 12:00:00 GMT',
    'Wednesday, 07-Oct-26 12:00:00 GMT',
    'Wed Oct  7 12:00:00 2026',
  ])('parses RFC HTTP date %s against supplied PG time', (raw) => {
    const hint = parseProviderRetryHint(raw)
    expect(hint?.kind).toBe('date')
    if (hint?.kind !== 'date') throw new Error('expected date')
    expect(retryDateAtPgClock(hint, new Date('2026-10-07T11:00:00Z'))?.toISOString()).toBe(
      '2026-10-07T12:00:00.000Z'
    )
  })
})
