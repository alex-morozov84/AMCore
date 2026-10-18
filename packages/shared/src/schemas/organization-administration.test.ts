import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE } from '../constants'
import { createInvitationOperationId } from '../lib/invitation-operation-id'

import {
  administratorAssignmentSchema,
  administratorInvitationCreateSchema,
  administratorReasonSchema,
} from './organization-administration'

describe('platform administrator command boundaries', () => {
  const input = () => ({
    operationId: createInvitationOperationId(),
    email: 'person@example.test',
    reason: 'Support TEST-49',
  })
  it('requires bounded operational reasons without control characters', () => {
    expect(administratorReasonSchema.parse('  TEST-49  ')).toBe('TEST-49')
    for (const value of ['', ' ', 'x'.repeat(501), 'hello\nworld', 'a\u0000b', 'a\u0085b'])
      expect(administratorReasonSchema.safeParse(value).success).toBe(false)
    expect(administratorReasonSchema.safeParse('Я'.repeat(500)).success).toBe(true)
  })
  it('refuses implicit role, membership, identity substitution and unknown input', () => {
    expect(administratorInvitationCreateSchema.parse(input()).inviteLocale).toBe(DEFAULT_LOCALE)
    for (const extra of [{ roleIds: ['member'] }, { userId: 'someone' }, { reason: '' }])
      expect(administratorInvitationCreateSchema.safeParse({ ...input(), ...extra }).success).toBe(
        false
      )
    expect(
      administratorAssignmentSchema.safeParse({
        operationId: createInvitationOperationId(),
        userId: 'user',
        reason: 'TEST-49',
      }).success
    ).toBe(false)
    expect(
      administratorAssignmentSchema.safeParse({
        operationId: createInvitationOperationId(),
        userId: 'user',
        expectedMemberId: 'member',
        expectedAclVersion: 0,
        reason: 'TEST-49',
      }).success
    ).toBe(true)
  })
})
