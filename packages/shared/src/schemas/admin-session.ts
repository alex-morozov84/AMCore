import { z } from 'zod'

import { sessionLocationSchema } from './auth'
import { paginatedResponseSchema, paginationQuerySchema } from './pagination'

/**
 * Admin session-list query. Reuses the canonical pagination query;
 * no search/sort — a user's active session count is small.
 */
export const adminSessionsQuerySchema = paginationQuerySchema

export type AdminSessionsQuery = z.infer<typeof adminSessionsQuerySchema>

/**
 * `Session.familyId`'s actual generated shape (`randomBytes(16).toString
 * ('hex')`, see `apps/api/src/core/auth/session.service.ts`): 32 lowercase
 * hex characters. Validated once here so the controller/DTO layer never
 * passes an unchecked route param into a raw query.
 */
export const adminSessionIdSchema = z.string().regex(/^[0-9a-f]{32}$/)

/**
 * One admin-visible session. `sessionId` is the stable, opaque
 * admin-facing identity — the existing non-secret `familyId`, distinct from
 * the physical row's CUID `id` and never a token hash. The list is
 * active-only (`revokedAt IS NULL AND expiresAt > now`), so `revokedAt` is
 * deliberately absent — it would always be `null` and add nothing.
 * `lastAuthAt` is the step-up/fresh-auth signal only, never "last activity".
 * `createdAt` is the current row's own creation time ("latest token
 * issued") — present at first login just as much as after any later
 * rotation, so it must never be worded as a promise that a refresh
 * occurred.
 */
export const adminSessionSchema = z.object({
  sessionId: adminSessionIdSchema,
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  location: sessionLocationSchema.nullable(),
  lastAuthAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
})

export type AdminSession = z.infer<typeof adminSessionSchema>

export const adminSessionsListResponseSchema = paginatedResponseSchema(adminSessionSchema)

export type AdminSessionsListResponse = z.infer<typeof adminSessionsListResponseSchema>

/** Result of a revoke-one/revoke-all admin mutation. */
export const adminSessionsRevokeResultSchema = z.object({
  affected: z.number().int().nonnegative(),
})

export type AdminSessionsRevokeResult = z.infer<typeof adminSessionsRevokeResultSchema>
