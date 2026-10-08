import { z } from 'zod'

import { ORGANIZATION_CONTEXT_ID_PATTERN } from '../constants/organization-context'

import {
  MEMBER_ASSIGNED_BYTES,
  MEMBER_MAX_ROLES,
  serializedJsonBytes,
} from './organization-members-budget'

export const memberIdSchema = z.string().regex(new RegExp(ORGANIZATION_CONTEXT_ID_PATTERN))
const search = z
  .string()
  .trim()
  .refine((s) => [...s].length <= 100)
  .optional()
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search,
}
const safeOffset = (q: { page: number; limit: number }) => (q.page - 1) * q.limit <= 2_147_483_647
/** `roleId` keeps only members who hold that role; an unknown or foreign role simply matches nobody. */
export const organizationMembersQuerySchema = z
  .strictObject({ ...pagination, roleId: memberIdSchema.optional() })
  .refine(safeOffset)
export const memberRolesQuerySchema = z
  .strictObject({
    ...pagination,
    section: z.enum(['available', 'assigned']).default('available'),
  })
  .refine(safeOffset)
export const memberRoleSummarySchema = z.strictObject({
  id: memberIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
})
const member = z.strictObject({
  memberId: memberIdSchema,
  user: z.strictObject({ id: memberIdSchema, name: z.string().nullable(), email: z.string() }),
})
export const organizationMembersResponseSchema = z.strictObject({
  data: z
    .array(
      member.extend({
        joinedAt: z.iso.datetime(),
        rolesPreview: z.array(memberRoleSummarySchema).max(10),
        assignedRoleCount: z.number().int().nonnegative(),
      })
    )
    .max(100),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().min(1).max(100),
  aclVersion: z.number().int().nonnegative(),
})
const roleRead = {
  member,
  aclVersion: z.number().int().nonnegative(),
  assignedRoleCount: z.number().int().nonnegative(),
  choices: z.strictObject({
    data: z.array(memberRoleSummarySchema).max(100),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().min(1).max(100),
  }),
}
export const memberRolesResponseSchema = z.discriminatedUnion('editMode', [
  z
    .strictObject({
      ...roleRead,
      editMode: z.literal('editable'),
      assignedRoles: z.array(memberRoleSummarySchema).max(MEMBER_MAX_ROLES),
    })
    .refine(
      (v) =>
        v.assignedRoleCount === v.assignedRoles.length &&
        serializedJsonBytes(v.assignedRoles) <= MEMBER_ASSIGNED_BYTES
    ),
  z.strictObject({
    ...roleRead,
    editMode: z.enum(['oversized', 'byteOversized']),
    assignedRoles: z.null(),
  }),
])
export const replaceMemberRolesSchema = z.strictObject({
  expectedMemberId: memberIdSchema,
  expectedAclVersion: z.number().int().min(0).max(2_147_483_646),
  roleIds: z
    .array(memberIdSchema)
    .max(MEMBER_MAX_ROLES)
    .refine((ids) => new Set(ids).size === ids.length),
})
export const replaceMemberRolesResponseSchema = z.strictObject({
  memberId: memberIdSchema,
  userId: memberIdSchema,
  organizationId: memberIdSchema,
  roleIds: z.array(memberIdSchema).max(MEMBER_MAX_ROLES),
  aclVersion: z.number().int().nonnegative(),
  changed: z.boolean(),
})
