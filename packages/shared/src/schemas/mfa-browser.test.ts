import { describe, expect, it } from 'vitest'

import { mfaProofSchema } from './mfa'
import {
  mfaBrowserCommandSchema,
  mfaBrowserResultSchema,
  mfaBrowserViewSchema,
  mfaEmergencyProofSchema,
} from './mfa-browser'

const operationId = '00000000-0000-4000-8000-000000000001'
const ticket = 'x'.repeat(43)
describe('MFA browser credential boundary', () => {
  it('keeps emergency tickets separate from TOTP and backup codes', () => {
    expect(mfaEmergencyProofSchema.safeParse({ password: '<password>', ticket }).success).toBe(true)
    expect(mfaProofSchema.safeParse({ method: 'recovery_code', code: ticket }).success).toBe(false)
    expect(mfaProofSchema.safeParse({ method: 'totp', code: ticket }).success).toBe(false)
    expect(
      mfaBrowserCommandSchema.safeParse({
        operationId,
        action: 'redeem_recovery_ticket',
        password: '<password>',
        ticket,
      }).success
    ).toBe(true)
    for (const command of [
      { action: 'verify', ticket },
      { action: 'redeem_recovery_ticket', ticket },
      { action: 'redeem_recovery_ticket', password: '<password>' },
      {
        action: 'redeem_recovery_ticket',
        password: '<password>',
        ticket,
        proof: { method: 'totp', code: '012345' },
      },
    ])
      expect(mfaBrowserCommandSchema.safeParse({ operationId, ...command }).success).toBe(false)
  })
  it('rejects raw backend credentials in read and result shapes', () => {
    for (const field of ['continuation', 'accessToken', 'refreshToken', 'publicationReceipt']) {
      expect(
        mfaBrowserViewSchema.safeParse({ kind: 'unavailable', [field]: '<credential>' }).success
      ).toBe(false)
      expect(
        mfaBrowserResultSchema.safeParse({ view: { kind: 'unavailable' }, [field]: '<credential>' })
          .success
      ).toBe(false)
    }
  })
  it('never accepts secret redisplay on status-only states', () => {
    expect(
      mfaBrowserResultSchema.safeParse({
        view: { kind: 'recovery_ticket', accountLabel: 'Demo' },
        enrollment: { secret: '<key>', otpauthUri: 'otpauth://totp/demo' },
      }).success
    ).toBe(false)
    expect(
      mfaBrowserResultSchema.safeParse({
        view: { kind: 'unavailable' },
        backupCodes: { codes: Array(10).fill('<code>'), generation: 1 },
      }).success
    ).toBe(false)
  })
})
