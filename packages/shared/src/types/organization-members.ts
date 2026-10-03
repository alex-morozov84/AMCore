import type { z } from 'zod'

import type {
  memberRolesQuerySchema,
  memberRolesResponseSchema,
  memberRoleSummarySchema,
  organizationMembersQuerySchema,
  organizationMembersResponseSchema,
  replaceMemberRolesResponseSchema,
  replaceMemberRolesSchema,
} from '../schemas/organization-members'

export type OrganizationMembersQuery = z.infer<typeof organizationMembersQuerySchema>
export type MemberRolesQuery = z.infer<typeof memberRolesQuerySchema>
export type MemberRoleSummary = z.infer<typeof memberRoleSummarySchema>
export type OrganizationMembersResponse = z.infer<typeof organizationMembersResponseSchema>
export type MemberRolesResponse = z.infer<typeof memberRolesResponseSchema>
export type ReplaceMemberRoles = z.infer<typeof replaceMemberRolesSchema>
export type ReplaceMemberRolesResponse = z.infer<typeof replaceMemberRolesResponseSchema>
