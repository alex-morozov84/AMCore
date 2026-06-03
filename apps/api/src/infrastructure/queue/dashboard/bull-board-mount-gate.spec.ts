import { isBullBoardEnabled } from './bull-board-mount-gate'

describe('isBullBoardEnabled (Bull Board mount gate — EQS-01)', () => {
  it('is disabled in production by default (zero attack surface)', () => {
    expect(isBullBoardEnabled('production', undefined)).toBe(false)
    expect(isBullBoardEnabled('production', 'false')).toBe(false)
  })

  it('is enabled in production only when explicitly set to "true"', () => {
    expect(isBullBoardEnabled('production', 'true')).toBe(true)
    // Any other truthy-looking string is NOT accepted.
    expect(isBullBoardEnabled('production', '1')).toBe(false)
    expect(isBullBoardEnabled('production', 'TRUE')).toBe(false)
  })

  it('is enabled outside production regardless of the flag (still auth-protected)', () => {
    expect(isBullBoardEnabled('development', undefined)).toBe(true)
    expect(isBullBoardEnabled('test', 'false')).toBe(true)
    expect(isBullBoardEnabled(undefined, undefined)).toBe(true)
  })

  it('is never enabled on the worker role, even when otherwise on (ADR-041)', () => {
    expect(isBullBoardEnabled('development', undefined, 'worker')).toBe(false)
    expect(isBullBoardEnabled('production', 'true', 'worker')).toBe(false)
    // web / all (or unset) keep the normal behavior
    expect(isBullBoardEnabled('development', undefined, 'web')).toBe(true)
    expect(isBullBoardEnabled('development', undefined, 'all')).toBe(true)
  })
})
