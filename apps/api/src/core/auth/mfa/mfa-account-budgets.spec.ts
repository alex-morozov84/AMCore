import { rollingBudget } from './mfa-account-budgets.js'

const now = new Date('2026-10-26T12:00:00Z')
describe('Bounded rolling MFA account budgets', () => {
  it('expires only old entries at the exact boundary and reports when the next slot opens', () => {
    const current = now.getTime()
    const values = [current - 900_000, ...Array<number>(9).fill(current - 1000)]
    expect(rollingBudget(values, 10, 900_000, now)).toMatchObject({
      allowed: true,
      retained: Array(9).fill(current - 1000),
    })
    expect(rollingBudget(Array(10).fill(current - 1000), 10, 900_000, now)).toMatchObject({
      allowed: false,
      retryAfter: 899,
    })
  })

  it('does not discard future charges when the clock moves backwards', () => {
    expect(rollingBudget(Array(10).fill(now.getTime() + 1000), 10, 900_000, now)).toMatchObject({
      allowed: false,
      retryAfter: 901,
    })
  })

  it.each([{}, ['invalid'], [-1], Array(11).fill(1)])(
    'refuses corrupt stored history %j',
    (value) => {
      expect(() => rollingBudget(value, 10, 900_000, now)).toThrow()
    }
  )
})
