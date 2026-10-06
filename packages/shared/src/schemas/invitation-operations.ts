import { z } from 'zod'

import { acceptIntentSchema, acceptInviteResponseSchema, inviteResponseSchema, revokeInviteResponseSchema } from './invite'

export const invitationOperationIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
export const invitationOperationResponseSchema = z.union([
  z.strictObject({ state: z.literal('unknown') }),
  z.strictObject({
    state: z.literal('committed'),
    intent: acceptIntentSchema,
    result: acceptInviteResponseSchema,
    access: z.enum(['present', 'removed']),
  }),
])
export const managerInviteOperationResponseSchema = z.union([
  z.strictObject({ state: z.literal('unknown') }),
  z.strictObject({
    state: z.literal('committed'),
    kind: z.enum(['create', 'reissue']),
    result: inviteResponseSchema,
  }),
  z.strictObject({
    state: z.literal('committed'),
    kind: z.literal('revoke'),
    result: revokeInviteResponseSchema,
  }),
])
export type InvitationOperationResponse = z.infer<typeof invitationOperationResponseSchema>
export type ManagerInviteOperationResponse = z.infer<typeof managerInviteOperationResponseSchema>
