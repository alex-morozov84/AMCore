import { describe, expect, it } from 'vitest'

import {
  createInvitationOperationId,
  invitationOperationTimestamp,
} from '../lib/invitation-operation-id'

import { invitationOperationIdSchema } from './invitation-operations'
import { acceptInviteSchema, createInviteSchema, reissueInviteSchema } from './invite'

const role = 'cm123456789012345678901234'
const intent = { expectedInviteId: role, expectedGeneration: 1 }

describe('invitation contracts', () => {
  it('requires a complete unique role set and rejects legacy single role input', () => {
    expect(createInviteSchema.safeParse({ email: 'user@example.com' }).success).toBe(true)
    for (const roleIds of [[], [role, role], Array.from({ length: 21 }, (_, i) => `${role}${i}`)])
      expect(createInviteSchema.safeParse({ email: 'user@example.com', roleIds }).success).toBe(
        false
      )
    expect(createInviteSchema.safeParse({ email: 'user@example.com', roleId: role }).success).toBe(
      false
    )
  })

  it('cannot shrink repeat intent implicitly or accept both credential carriers', () => {
    expect(
      reissueInviteSchema.safeParse({ mode: 'repeat', expectedGeneration: 1, roleIds: [role] })
        .success
    ).toBe(false)
    expect(acceptInviteSchema.safeParse({ ...intent, token: 'a'.repeat(43) }).success).toBe(true)
    expect(acceptInviteSchema.safeParse({ ...intent, continuation: true }).success).toBe(true)
    expect(
      acceptInviteSchema.safeParse({ ...intent, continuation: true, token: 'a'.repeat(43) }).success
    ).toBe(false)
    expect(acceptInviteSchema.safeParse({ token: 'a'.repeat(43) }).success).toBe(false)
  })

  it('generates independent random UUIDv7 suffixes with recoverable timestamps', () => {
    const now = 1_800_000_000_000
    const ids = Array.from({ length: 100 }, () => createInvitationOperationId(now))
    expect(new Set(ids).size).toBe(100)
    for (const id of ids) {
      expect(invitationOperationIdSchema.parse(id)).toBe(id)
      expect(invitationOperationTimestamp(id)).toBe(now)
    }
    expect(() => createInvitationOperationId(-1)).toThrow(RangeError)
    expect(
      invitationOperationIdSchema.safeParse('00000000-0000-4000-8000-000000000000').success
    ).toBe(false)
  })
})
