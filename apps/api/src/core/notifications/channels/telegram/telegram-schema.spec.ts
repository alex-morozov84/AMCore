import { telegramConnectionResponseSchema, telegramLinkResponseSchema } from '@amcore/shared'

/**
 * Contract tests for the shared Telegram linking responses. The connection status is a
 * `@ZodResponse` boundary, so the schema must make a contradictory state unrepresentable
 * (Finding D.1.1) — a real control, not a prose assertion.
 */
describe('telegramConnectionResponseSchema', () => {
  it('accepts the disconnected variant (false + null + null)', () => {
    const result = telegramConnectionResponseSchema.safeParse({
      connected: false,
      status: null,
      linkedAt: null,
    })

    expect(result.success).toBe(true)
  })

  it('accepts the connected variant (true + status + datetime)', () => {
    const result = telegramConnectionResponseSchema.safeParse({
      connected: true,
      status: 'active',
      linkedAt: '2026-06-20T10:00:00.000Z',
    })

    expect(result.success).toBe(true)
  })

  it('accepts a blocked connection', () => {
    expect(
      telegramConnectionResponseSchema.safeParse({
        connected: true,
        status: 'blocked',
        linkedAt: '2026-06-20T10:00:00.000Z',
      }).success
    ).toBe(true)
  })

  it('rejects disconnected carrying a status', () => {
    expect(
      telegramConnectionResponseSchema.safeParse({
        connected: false,
        status: 'active',
        linkedAt: null,
      }).success
    ).toBe(false)
  })

  it('rejects connected without a status', () => {
    expect(
      telegramConnectionResponseSchema.safeParse({
        connected: true,
        status: null,
        linkedAt: null,
      }).success
    ).toBe(false)
  })

  it('rejects an unknown status value', () => {
    expect(
      telegramConnectionResponseSchema.safeParse({
        connected: true,
        status: 'pending',
        linkedAt: '2026-06-20T10:00:00.000Z',
      }).success
    ).toBe(false)
  })
})

describe('telegramLinkResponseSchema', () => {
  it('accepts a deep-link URL with an expiry', () => {
    const result = telegramLinkResponseSchema.safeParse({
      url: 'https://t.me/amcore_bot?start=abc123',
      expiresAt: '2026-06-20T10:15:00.000Z',
    })

    expect(result.success).toBe(true)
  })

  it('rejects a non-URL link', () => {
    expect(
      telegramLinkResponseSchema.safeParse({
        url: 'not-a-url',
        expiresAt: '2026-06-20T10:15:00.000Z',
      }).success
    ).toBe(false)
  })
})
