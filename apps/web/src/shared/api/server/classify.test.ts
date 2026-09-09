import { describe, expect, it } from 'vitest'

import { classifyStatus, classifyThrown } from './classify'

describe('classifyStatus', () => {
  it.each([
    [404, 'not-found'],
    [429, 'rate-limited'],
    [500, 'upstream'],
    [503, 'upstream'],
    [599, 'upstream'],
  ] as const)('maps %i to %s', (status, expected) => {
    expect(classifyStatus(status)).toBe(expected)
  })

  it.each([400, 401, 403, 409, 422])('maps other 4xx (%i) to rejected', (status) => {
    expect(classifyStatus(status)).toBe('rejected')
  })
})

describe('classifyThrown', () => {
  it('classifies AbortSignal.timeout()-style DOMException as timeout', () => {
    expect(classifyThrown(new DOMException('The operation was aborted', 'TimeoutError'))).toBe(
      'timeout'
    )
  })

  it('classifies an AbortError as timeout', () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    expect(classifyThrown(error)).toBe('timeout')
  })

  it('classifies a TypeError (undici connection failure shape) as network', () => {
    expect(classifyThrown(new TypeError('fetch failed'))).toBe('network')
  })

  it('returns null for an unrecognized error — must not be silently absorbed', () => {
    expect(classifyThrown(new Error('a genuine bug'))).toBeNull()
    expect(classifyThrown('not even an Error')).toBeNull()
    expect(classifyThrown(undefined)).toBeNull()
  })
})
