import { z } from 'zod'

import { PAGINATION } from '../constants'

import { adminOrganizationResponseSchema, adminUserResponseSchema } from './admin'
import { paginatedResponseSchema, paginationQuerySchema } from './pagination'

export const adminDetailIdSchema = z.union([z.cuid(), z.uuid()])

const roleSchema = z.object({ id: z.string(), name: z.string() })

export const adminUserMembershipSchema = z.object({
  organization: adminOrganizationResponseSchema.pick({ id: true, name: true, slug: true }),
  roles: z.array(roleSchema),
  joinedAt: z.iso.datetime(),
})

export const adminOrganizationMemberSchema = z.object({
  user: adminUserResponseSchema.pick({ id: true, name: true, email: true }),
  roles: z.array(roleSchema),
  joinedAt: z.iso.datetime(),
})

const queryNumber = (max: number) =>
  z.union([z.string(), z.number()]).pipe(z.coerce.number<string | number>().int().min(1).max(max))

export const adminUserDetailQuerySchema = paginationQuerySchema.extend({
  page: queryNumber(1_000_000).default(PAGINATION.DEFAULT_PAGE),
  limit: queryNumber(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
  search: z
    .string()
    .max(255)
    .optional()
    .transform((value) => value?.trim() || undefined),
})

export const adminOrganizationDetailQuerySchema = adminUserDetailQuerySchema

export const adminUserDetailResponseSchema = z.object({
  user: adminUserResponseSchema,
  memberships: paginatedResponseSchema(adminUserMembershipSchema),
  membershipCount: z.number().int().nonnegative(),
})

export const adminOrganizationDetailResponseSchema = z.object({
  organization: adminOrganizationResponseSchema,
  members: paginatedResponseSchema(adminOrganizationMemberSchema),
  memberCount: z.number().int().nonnegative(),
})

export type AdminUserDetailQuery = z.infer<typeof adminUserDetailQuerySchema>
export type AdminOrganizationDetailQuery = z.infer<typeof adminOrganizationDetailQuerySchema>
export type AdminUserDetailResponse = z.infer<typeof adminUserDetailResponseSchema>
export type AdminOrganizationDetailResponse = z.infer<typeof adminOrganizationDetailResponseSchema>
