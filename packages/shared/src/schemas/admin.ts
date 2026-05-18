import { z } from 'zod'

import { SystemRole } from '../enums'

import { userResponseSchema } from './auth'

/** Update user system role (SUPER_ADMIN only) */
export const updateUserSystemRoleSchema = z.object({
  systemRole: z.enum([SystemRole.User, SystemRole.SuperAdmin]),
})

export type UpdateUserSystemRoleInput = z.infer<typeof updateUserSystemRoleSchema>

/**
 * Admin-facing user response (OA-07).
 *
 * Superset of `userResponseSchema` with `systemRole` and `updatedAt` —
 * fields admin operators legitimately need but self-view paths
 * deliberately do not expose. Critically excludes `passwordHash` and
 * `emailCanonical` so admin responses cannot leak credential hashes
 * or internal normalization details.
 */
export const adminUserResponseSchema = userResponseSchema.extend({
  systemRole: z.enum([SystemRole.User, SystemRole.SuperAdmin]),
  updatedAt: z.iso.datetime(),
})

export type AdminUserResponse = z.infer<typeof adminUserResponseSchema>

/**
 * Admin user list response — flat envelope `{ data, total }`.
 *
 * Stage 5 / Commit 2 (OA-08) replaces this with
 * `paginatedResponseSchema(adminUserResponseSchema)` adding `page` and
 * `limit` for client convenience.
 */
export const adminUserListResponseSchema = z.object({
  data: z.array(adminUserResponseSchema),
  total: z.number().int().nonnegative(),
})

export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>
