import { z } from 'zod'

import { loginSchema, userResponseSchema } from './auth'
import { invitationOperationIdSchema } from './invitation-operations'
import {
  invitationContextSchema,
  invitationInspectResponseSchema,
  invitedRegisterSchema,
} from './invitation-recipient'
import { acceptIntentSchema, acceptInviteResponseSchema } from './invite'

/** A browser-visible selector; authority additionally requires the HttpOnly owner proof. */
export const invitationFlowIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/)
export const invitationSessionBindingSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const invitationFlowBindingSchema = z.strictObject({
  flowId: invitationFlowIdSchema,
  flowRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sessionBinding: invitationSessionBindingSchema.nullable(),
})
export const invitationFlowExpectedSchema = z.strictObject({ binding: invitationFlowBindingSchema })
export const invitationFlowLoginSchema = loginSchema
  .extend(invitationFlowExpectedSchema.shape)
  .strict()
export const invitationFlowRegisterSchema = invitedRegisterSchema
  .extend(invitationFlowExpectedSchema.shape)
  .strict()
export const invitationFlowAcceptSchema = z.strictObject({
  ...invitationFlowExpectedSchema.shape,
  ...acceptIntentSchema.shape,
  operationId: invitationOperationIdSchema,
})

export const invitationFlowContextResponseSchema = z.strictObject({
  binding: invitationFlowBindingSchema,
  data: invitationContextSchema,
})
export const invitationFlowInspectResponseSchema = z.strictObject({
  binding: invitationFlowBindingSchema,
  data: invitationInspectResponseSchema,
})
export const invitationFlowAuthResponseSchema = z.strictObject({
  binding: invitationFlowBindingSchema,
  data: z.strictObject({ user: userResponseSchema }),
  handoff: z.strictObject({ attemptId: invitationFlowIdSchema }),
})
export const invitationFlowAcceptResponseSchema = z.strictObject({
  binding: invitationFlowBindingSchema,
  data: acceptInviteResponseSchema,
})
export const invitationFlowPendingResponseSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('authenticating'), binding: invitationFlowBindingSchema }),
  z.strictObject({
    state: z.literal('completing_signin'),
    binding: invitationFlowBindingSchema,
    handoff: z.strictObject({ attemptId: invitationFlowIdSchema }),
  }),
])
export const invitationFlowSwitchResponseSchema = z.strictObject({
  binding: invitationFlowBindingSchema,
  data: z.strictObject({ status: z.literal('signed_out') }),
})
export const invitationFlowOAuthResponseSchema = z.strictObject({
  binding: invitationFlowBindingSchema,
  authorizeHref: z
    .string()
    .regex(/^\/api\/auth\/oauth\/(google|github|apple)\?invitationAttempt=[A-Za-z0-9_-]{22}$/),
})
export const invitationFlowVerificationResponseSchema = z.strictObject({
  binding: invitationFlowBindingSchema,
  data: z.strictObject({ user: userResponseSchema, inspection: invitationInspectResponseSchema }),
})
export const invitationVerificationReturnInputSchema = z.strictObject({
  expectedSessionBinding: invitationSessionBindingSchema,
})
export const invitationVerificationReturnLinkSchema = z.strictObject({
  verifyHref: z
    .string()
    .regex(/^\/(?:[a-z]{2}(?:-[A-Za-z0-9]+)?\/)?verify-email\?inviteReturn=[A-Za-z0-9_-]{22}$/),
})
export const invitationVerificationReturnResponseSchema = z.strictObject({
  destination: z
    .string()
    .regex(/^\/(?:[a-z]{2}(?:-[A-Za-z0-9]+)?\/)?invite\/flow\/[A-Za-z0-9_-]{22}$/),
  binding: invitationFlowBindingSchema,
})
export type InvitationFlowBinding = z.infer<typeof invitationFlowBindingSchema>
export type InvitationFlowLogin = z.infer<typeof invitationFlowLoginSchema>
export type InvitationFlowRegister = z.infer<typeof invitationFlowRegisterSchema>
export type InvitationFlowAccept = z.infer<typeof invitationFlowAcceptSchema>
export type InvitationFlowAuthResponse = z.infer<typeof invitationFlowAuthResponseSchema>
