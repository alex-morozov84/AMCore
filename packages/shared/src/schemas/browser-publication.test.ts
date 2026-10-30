import { describe, expect, it } from 'vitest'

import {
  browserAudienceSchema,
  browserContextBootstrapSchema,
  browserContextViewSchema,
  browserRevisionSchema,
} from './browser-publication'

const view = {
  contextId: 'context',
  generation: 0,
  state: 'empty',
  expiresAt: '2026-10-26T12:15:00.000Z',
}

describe('Browser publication transport separates binding from account-neutral status', () => {
  it('accepts only canonical server-selected audiences', () => {
    expect(
      ['product', 'staff', 'console'].every(
        (audience) => browserAudienceSchema.safeParse(audience).success
      )
    ).toBe(true)
    expect(browserAudienceSchema.safeParse('api').success).toBe(false)
  })

  it('accepts an initial revision and rejects unsafe generation values', () => {
    expect(browserRevisionSchema.safeParse({ contextId: 'context', generation: 0 }).success).toBe(
      true
    )
    for (const generation of [-1, 0.5, 2147483648])
      expect(browserRevisionSchema.safeParse({ contextId: 'context', generation }).success).toBe(
        false
      )
  })

  it.each([
    'binding',
    'user',
    'userSnapshot',
    'accessToken',
    'refreshToken',
    'continuation',
    'receipt',
    'familyId',
  ])('refuses %s on a browser-readable context status', (key) => {
    expect(
      browserContextViewSchema.safeParse({ ...view, [key]: 'not-a-browser-field' }).success
    ).toBe(false)
  })

  it('keeps the one-time bootstrap binding in the server-only envelope', () => {
    const result = { binding: 'a'.repeat(43), view }
    expect(browserContextBootstrapSchema.safeParse(result).success).toBe(true)
    expect(browserContextViewSchema.safeParse(result).success).toBe(false)
    expect(browserContextBootstrapSchema.safeParse({ ...result, binding: 'short' }).success).toBe(
      false
    )
  })
})
