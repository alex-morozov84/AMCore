import { describe, expect, it } from 'vitest'

import { supportMailPrepareSchema, supportMailReceiptSchema } from './admin-support-mail'

const id = '00000000-0000-4000-8000-000000000001'
const receipt = {
  evidence: 'stored',
  attemptId: id,
  kind: 'password_recovery',
  outcome: 'unknown',
  tokenIssued: true,
  provider: 'resend',
  reason: 'provider_failure',
  attemptedAt: '2026-10-24T12:00:00.000Z',
  settledAt: null,
  readUntil: '2026-10-25T12:00:00.000Z',
}

describe('support-mail public contracts', () => {
  it('allows only a kind in preparation and no recipient or transport options', () => {
    expect(supportMailPrepareSchema.safeParse({ kind: 'password_recovery' }).success).toBe(true)
    for (const extra of [
      { recipient: 'other@example.test' },
      { url: 'https://elsewhere.test' },
      { retry: true },
    ])
      expect(
        supportMailPrepareSchema.safeParse({ kind: 'password_recovery', ...extra }).success
      ).toBe(false)
  })
  it('distinguishes an unconfirmed observation from a terminal unknown fact', () => {
    expect(supportMailReceiptSchema.safeParse(receipt).success).toBe(true)
    expect(
      supportMailReceiptSchema.safeParse({ evidence: 'unconfirmed', attemptId: id }).success
    ).toBe(true)
    expect(
      supportMailReceiptSchema.safeParse({
        evidence: 'unconfirmed',
        attemptId: id,
        outcome: 'unknown',
      }).success
    ).toBe(false)
    expect(supportMailReceiptSchema.safeParse({ ...receipt, outcome: 'delivered' }).success).toBe(
      false
    )
  })
  it('rejects secret-bearing extra fields and arbitrary provider explanations', () => {
    for (const extra of [
      { token: '<fake-token>' },
      { html: 'body' },
      { url: 'https://elsewhere.test' },
      { reason: 'raw provider error' },
    ])
      expect(supportMailReceiptSchema.safeParse({ ...receipt, ...extra }).success).toBe(false)
  })
})
