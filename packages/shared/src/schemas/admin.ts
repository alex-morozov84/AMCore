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

/** Per-dependency readiness state, sanitized to name + up/down/unknown only. */
export const adminOverviewDependencySchema = z.object({
  name: z.string(),
  status: z.enum(['up', 'down', 'unknown']),
})

export type AdminOverviewDependency = z.infer<typeof adminOverviewDependencySchema>

/**
 * Console Overview status (`GET /admin/overview`).
 *
 * Always a typed 200, even when the observed instance is degraded:
 * `readiness: 'not_ready'` is how "this API instance told us it isn't
 * ready" is reported, kept distinct from a real transport failure
 * reaching this endpoint itself (network error, timeout, 5xx) — which
 * must stay classified by the caller as "the observation could not be
 * fetched", not folded into this same 200 shape.
 */
export const adminOverviewResponseSchema = z.object({
  readiness: z.enum(['ready', 'not_ready']),
  dependencies: z.array(adminOverviewDependencySchema),
  version: z.string(),
  processRole: z.enum(['web', 'worker', 'all']),
})

export type AdminOverviewResponse = z.infer<typeof adminOverviewResponseSchema>
