import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE } from '../constants'
import { createInvitationOperationId } from '../lib/invitation-operation-id'

import {
  provisioningCreateSchema,
  provisioningReissueSchema,
  provisioningReplaceSchema,
} from './organization-provisioning'

const input = () => ({
  operationId: createInvitationOperationId(),
  name: 'North shop',
  firstAdminEmail: 'anna@example.test',
})
describe('operator provisioning contracts', () => {
  it('defaults headless invitation language and keeps optional identifier', () => {
    expect(provisioningCreateSchema.parse(input())).toMatchObject({ inviteLocale: DEFAULT_LOCALE })
  })
  it.each(['roleIds', 'userId', 'password', 'token'])('rejects caller-supplied %s', (field) => {
    expect(provisioningCreateSchema.safeParse({ ...input(), [field]: 'fake' }).success).toBe(false)
  })
  it('rejects unknown operation identity and locale', () => {
    expect(provisioningCreateSchema.safeParse({ ...input(), operationId: 'unknown' }).success).toBe(
      false
    )
    expect(
      provisioningCreateSchema.safeParse({ ...input(), inviteLocale: 'unknown' }).success
    ).toBe(false)
  })
  it('requires expected revision and invitation identity for reissue', () => {
    expect(
      provisioningReissueSchema.safeParse({
        operationId: createInvitationOperationId(),
        expectedGeneration: 1,
      }).success
    ).toBe(false)
    expect(
      provisioningReplaceSchema.safeParse({
        operationId: createInvitationOperationId(),
        expectedRevision: 1,
        firstAdminEmail: 'anna@example.test',
      }).success
    ).toBe(true)
  })
})
