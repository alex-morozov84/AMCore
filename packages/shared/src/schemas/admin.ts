import { z } from 'zod'

import { SystemRole } from '../enums'

import { userResponseSchema } from './auth'
import { paginatedResponseSchema, paginationQuerySchema } from './pagination'

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

/** Shared sort direction for every admin discovery list query. */
export const adminSortOrderSchema = z.enum(['asc', 'desc'])

export type AdminSortOrder = z.infer<typeof adminSortOrderSchema>

/**
 * Normalizes a raw `search` query value to "no filter" on missing or
 * whitespace-only input. `.trim().min(1)` alone would 400 on a
 * whitespace-only value instead of treating it as absent — this runs
 * after the raw string has already passed its length bound, so an
 * oversized value is still rejected before normalization ever sees it.
 */
function normalizeSearch(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Users discovery list query (`GET /admin/users`). `sortOrder` has no
 * schema-level default: the per-field default direction (ascending for
 * text, descending for a timestamp) is resolved in `AdminService`, not
 * hardcoded once here.
 */
export const ADMIN_USER_SORT_FIELDS = [
  'name',
  'email',
  'lastLoginAt',
  'createdAt',
  'updatedAt',
] as const

export type AdminUserSortField = (typeof ADMIN_USER_SORT_FIELDS)[number]

export const adminUserListQuerySchema = paginationQuerySchema.extend({
  search: z.string().max(255).optional().transform(normalizeSearch),
  sortBy: z.enum(ADMIN_USER_SORT_FIELDS).default('createdAt'),
  sortOrder: adminSortOrderSchema.optional(),
})

export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>

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

/** Organizations discovery list query (`GET /admin/organizations`) — same contract shape as Users. */
export const ADMIN_ORGANIZATION_SORT_FIELDS = ['name', 'slug', 'createdAt', 'updatedAt'] as const

export type AdminOrganizationSortField = (typeof ADMIN_ORGANIZATION_SORT_FIELDS)[number]

export const adminOrganizationListQuerySchema = paginationQuerySchema.extend({
  search: z.string().max(255).optional().transform(normalizeSearch),
  sortBy: z.enum(ADMIN_ORGANIZATION_SORT_FIELDS).default('createdAt'),
  sortOrder: adminSortOrderSchema.optional(),
})

export type AdminOrganizationListQuery = z.infer<typeof adminOrganizationListQuerySchema>

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

/**
 * Closed allowlist of dependency identifiers `GET /admin/overview` may name.
 * Enforced here (never a plain `z.string()`) and again at the service
 * boundary (`AdminOverviewService`) so an indicator key outside this set —
 * present or future — is dropped, never forwarded to the browser.
 */
export const ADMIN_OVERVIEW_DEPENDENCY_NAMES = [
  'database',
  'redis',
  'disk',
  'memory_heap',
  'storage',
] as const

/** Per-dependency readiness state, sanitized to name + up/down/unknown only. */
export const adminOverviewDependencySchema = z.object({
  name: z.enum(ADMIN_OVERVIEW_DEPENDENCY_NAMES),
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
