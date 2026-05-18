import { z } from 'zod'

import { emailInputSchema } from './auth'
import { paginatedResponseSchema } from './pagination'

// ===========================================
// Request Schemas
// ===========================================

/**
 * Create invite (OB-02).
 *
 * Replaces the previous `inviteMemberSchema` semantics. The endpoint
 * accepts an email and an optional roleId; the response is uniform
 * `{ status: 'invited' }` regardless of whether the email has an
 * account, is already a member, or is unknown — see OB-02 for the
 * non-enumeration contract.
 */
export const createInviteSchema = z.object({
  email: emailInputSchema,
  roleId: z.string().optional(),
})

export type CreateInviteInput = z.infer<typeof createInviteSchema>

/**
 * Accept invite. Caller must be authenticated; `emailCanonical` of the
 * authenticated user must match the invite's `emailCanonical`. The raw
 * token is taken from the email link.
 */
export const acceptInviteSchema = z.object({
  token: z.string().min(32).max(128),
})

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>

// ===========================================
// Response Schemas
// ===========================================

/**
 * Uniform success response for `POST /organizations/:orgId/members/invite`.
 * The literal `status: 'invited'` is the entire wire shape — no fields
 * leak whether the target email is registered, already a member, or
 * pending. See `InviteErrorCode` for the negative-path codes.
 */
export const inviteResponseSchema = z.object({
  status: z.literal('invited'),
})

export type InviteResponse = z.infer<typeof inviteResponseSchema>

/**
 * Response for `POST /auth/invites/accept` on success.
 *
 * `roleId` is always a concrete role id — never null. If the invite's
 * named custom role was deleted before accept (FK `SetNull` left
 * `invite.roleId` null), the accept handler assigns the system MEMBER
 * role as a lower-privilege fallback and returns that id.
 */
export const acceptInviteResponseSchema = z.object({
  organizationId: z.string(),
  roleId: z.string(),
})

export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>

/**
 * Item in `GET /organizations/:orgId/invites`. Active invites only —
 * `acceptedAt`/`revokedAt` rows are filtered server-side. No token or
 * tokenHash is ever returned.
 */
export const inviteListItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  roleId: z.string().nullable(),
  invitedById: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
})

export type InviteListItem = z.infer<typeof inviteListItemSchema>

/** Paginated invite list per ADR-036. */
export const inviteListResponseSchema = paginatedResponseSchema(inviteListItemSchema)

export type InviteListResponse = z.infer<typeof inviteListResponseSchema>
