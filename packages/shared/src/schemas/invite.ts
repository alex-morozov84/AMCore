import { z } from 'zod'

import { emailInputSchema } from './auth'
import { inviteGenerationSchema, inviteTokenSchema } from './invitation-common'
import { memberIdSchema, memberRoleSummarySchema } from './organization-members'
export { inviteGenerationSchema, inviteTokenSchema } from './invitation-common'

import { paginatedResponseSchema } from './pagination'

export const INVITE_MAX_ROLES = 20
export const inviteRoleIdsSchema = z
  .array(memberIdSchema)
  .min(1)
  .max(INVITE_MAX_ROLES)
  .refine((ids) => new Set(ids).size === ids.length)
export const createInviteSchema = z.strictObject({
  email: emailInputSchema.pipe(z.string().max(254)),
  roleIds: inviteRoleIdsSchema.optional(),
})
export const reissueInviteSchema = z.discriminatedUnion('mode', [
  z.strictObject({ expectedGeneration: inviteGenerationSchema, mode: z.literal('repeat') }),
  z.strictObject({
    expectedGeneration: inviteGenerationSchema,
    mode: z.literal('replace'),
    roleIds: inviteRoleIdsSchema,
  }),
])
export const revokeInviteQuerySchema = z.strictObject({
  expectedGeneration: z.coerce.number().int().positive().max(2_147_483_647),
})
export const acceptIntentSchema = z.strictObject({
  expectedInviteId: memberIdSchema,
  expectedGeneration: inviteGenerationSchema,
})
export const acceptInviteSchema = z.union([
  acceptIntentSchema.extend({ token: inviteTokenSchema }),
  acceptIntentSchema.extend({ continuation: z.literal(true) }),
])
export const inviteResponseSchema = z.strictObject({ status: z.literal('invited') })
/** Typed BFF/receipt acknowledgment; the direct DELETE API still returns an empty204. */
export const revokeInviteResponseSchema = z.strictObject({ status: z.literal('revoked') })
export const acceptInviteResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('accepted'),
    organizationId: memberIdSchema,
    memberId: memberIdSchema,
  }),
  z.strictObject({ status: z.literal('already_access'), organizationId: memberIdSchema }),
])
const pagination = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}
export const inviteListQuerySchema = z.strictObject({
  ...pagination,
  search: z.string().trim().max(254).optional(),
  status: z.enum(['pending', 'expired', 'all']).default('pending'),
})
export const inviteRoleChoicesQuerySchema = z.strictObject({
  ...pagination,
  search: z.string().trim().max(100).optional(),
})
export const inviteRoleChoiceSchema = memberRoleSummarySchema
export const inviteRoleChoicesResponseSchema = paginatedResponseSchema(
  inviteRoleChoiceSchema
).extend({ defaultRole: inviteRoleChoiceSchema })
export const inviteListItemSchema = z.strictObject({
  id: memberIdSchema,
  email: z.string(),
  generation: inviteGenerationSchema,
  issuedAt: z.iso.datetime(),
  issuedAtEstimated: z.boolean(),
  expiresAt: z.iso.datetime(),
  status: z.enum(['pending', 'expired']),
  intentValid: z.boolean(),
  roles: z
    .array(
      z.strictObject({
        requestedRoleId: memberIdSchema,
        id: memberIdSchema.nullable(),
        nameAtIssue: z.string(),
        name: z.string().nullable(),
        description: z.string().nullable(),
      })
    )
    .max(INVITE_MAX_ROLES),
})
export const inviteListResponseSchema = paginatedResponseSchema(inviteListItemSchema)
export type CreateInviteInput = z.infer<typeof createInviteSchema>
export type ReissueInviteInput = z.infer<typeof reissueInviteSchema>
export type AcceptIntent = z.infer<typeof acceptIntentSchema>
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>
export type InviteResponse = z.infer<typeof inviteResponseSchema>
export type RevokeInviteResponse = z.infer<typeof revokeInviteResponseSchema>
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>
export type InviteListItem = z.infer<typeof inviteListItemSchema>
export type InviteListResponse = z.infer<typeof inviteListResponseSchema>
export type InviteListQuery = z.infer<typeof inviteListQuerySchema>
export type InviteRoleChoicesQuery = z.infer<typeof inviteRoleChoicesQuerySchema>
export type InviteRoleChoicesResponse = z.infer<typeof inviteRoleChoicesResponseSchema>
