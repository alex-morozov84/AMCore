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

/**
 * Manual cleanup-run result (`POST /admin/cleanup`).
 *
 * Per-type counts of expired records swept this run, plus `failures` — the
 * record types whose delete failed without aborting the others (EQS-04). Wire
 * shape mirrors `CleanupResult` in `infrastructure/schedule/cleanup.service.ts`.
 */
export const cleanupResultSchema = z.object({
  expiredSessions: z.number().int(),
  expiredPasswordResetTokens: z.number().int(),
  expiredEmailVerificationTokens: z.number().int(),
  expiredApiKeys: z.number().int(),
  expiredPendingInvites: z.number().int(),
  staleTerminalInvites: z.number().int(),
  failures: z.array(z.string()),
})

export type CleanupResultResponse = z.infer<typeof cleanupResultSchema>
