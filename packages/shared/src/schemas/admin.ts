import { z } from 'zod'

import { SystemRole } from '../enums'

import { userResponseSchema } from './auth'
import { paginatedResponseSchema } from './pagination'

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

/** Paginated admin user list (OA-08 envelope). */
export const adminUserListResponseSchema = paginatedResponseSchema(adminUserResponseSchema)

export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>

/**
 * Admin-facing organization response (OA-08).
 *
 * Deliberately omits `aclVersion` (internal RBAC freshness counter
 * documented in ADR-035; not part of the admin product surface).
 */
export const adminOrganizationResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type AdminOrganizationResponse = z.infer<typeof adminOrganizationResponseSchema>

/** Paginated admin organization list (OA-08 envelope). */
export const adminOrganizationListResponseSchema = paginatedResponseSchema(
  adminOrganizationResponseSchema
)

export type AdminOrganizationListResponse = z.infer<typeof adminOrganizationListResponseSchema>
