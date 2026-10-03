import { describe, expect, it } from 'vitest'

import {
  memberRolesResponseSchema,
  organizationMembersQuerySchema,
  replaceMemberRolesSchema,
} from './organization-members'
import { MEMBER_ASSIGNED_BYTES, serializedJsonBytes } from './organization-members-budget'

const summary = { id: 'role', name: 'Role', description: null, isSystem: false }
const base = {
  member: { memberId: 'member', user: { id: 'user', name: null, email: 'user@example.test' } },
  aclVersion: 0,
  assignedRoleCount: 1,
  choices: { data: [], total: 0, page: 1, limit: 20 },
}
describe('member contracts and serialized byte boundaries', () => {
  it('accepts canonical1000 distinct128-character IDs, rejects duplicates and1001', () => {
    const roleIds = Array.from({ length: 1000 }, (_, i) => String(i).padEnd(128, 'a'))
    const dto = { expectedMemberId: 'm'.repeat(128), expectedAclVersion: 0, roleIds }
    expect(replaceMemberRolesSchema.safeParse(dto).success).toBe(true)
    expect(serializedJsonBytes(dto)).toBe(131186)
    expect(
      replaceMemberRolesSchema.safeParse({ ...dto, roleIds: [...roleIds, 'extra'] }).success
    ).toBe(false)
    expect(replaceMemberRolesSchema.safeParse({ ...dto, roleIds: ['a', 'a'] }).success).toBe(false)
    expect(replaceMemberRolesSchema.safeParse({ ...dto, roleIds: [] }).success).toBe(true)
  })
  it('measures Unicode, escaping and lone surrogates as actual UTF-8 JSON', () => {
    const cases: [string, number][] = [
      ['漢'.repeat(50), 152],
      ['😀'.repeat(25), 102],
      ['\u0000'.repeat(255), 1532],
      ['\ud800', 8],
      ['\\"', 6],
    ]
    for (const [value, bytes] of cases) expect(serializedJsonBytes(value)).toBe(bytes)
  })
  it('requires a complete editable set and admits explicit byte-degraded mode', () => {
    expect(
      memberRolesResponseSchema.safeParse({ ...base, editMode: 'editable', assignedRoles: [] })
        .success
    ).toBe(false)
    const empty = [{ ...summary, description: '' }]
    const padding = MEMBER_ASSIGNED_BYTES - serializedJsonBytes(empty)
    const roles = [{ ...summary, description: 'a'.repeat(padding) }]
    expect(serializedJsonBytes(roles)).toBe(MEMBER_ASSIGNED_BYTES)
    expect(
      memberRolesResponseSchema.safeParse({ ...base, editMode: 'editable', assignedRoles: roles })
        .success
    ).toBe(true)
    roles[0]!.description += 'a'
    expect(
      memberRolesResponseSchema.safeParse({ ...base, editMode: 'editable', assignedRoles: roles })
        .success
    ).toBe(false)
    expect(
      memberRolesResponseSchema.safeParse({
        ...base,
        editMode: 'byteOversized',
        assignedRoles: null,
      }).success
    ).toBe(true)
  })
  it('bounds Unicode search and offset, rejecting unknown fields', () => {
    expect(organizationMembersQuerySchema.safeParse({ search: '😀'.repeat(100) }).success).toBe(
      true
    )
    expect(organizationMembersQuerySchema.safeParse({ search: '😀'.repeat(101) }).success).toBe(
      false
    )
    expect(organizationMembersQuerySchema.safeParse({ page: 2147483647, limit: 100 }).success).toBe(
      false
    )
    expect(organizationMembersQuerySchema.safeParse({ secret: true }).success).toBe(false)
  })
})
