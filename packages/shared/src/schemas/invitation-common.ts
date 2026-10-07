import { z } from 'zod'

import { ORGANIZATION_CONTEXT_ID_PATTERN } from '../constants/organization-context'

export const inviteGenerationSchema = z.number().int().positive().max(2_147_483_647)
export const inviteTokenSchema = z.string().min(32).max(128)
export const invitationOAuthCorrelationSchema = z.strictObject({
  attemptId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  provider: z.enum(['google', 'github', 'apple']),
  expectedInviteId: z.string().regex(new RegExp(ORGANIZATION_CONTEXT_ID_PATTERN)),
  expectedGeneration: inviteGenerationSchema,
  backendSessionId: z.string().regex(new RegExp(ORGANIZATION_CONTEXT_ID_PATTERN)),
})
export type InvitationOAuthCorrelation = z.infer<typeof invitationOAuthCorrelationSchema>
