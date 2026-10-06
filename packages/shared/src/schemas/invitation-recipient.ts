import { z } from 'zod'

import { registerSchema } from './auth'
import { acceptIntentSchema, inviteGenerationSchema, inviteTokenSchema } from './invite'
import { memberIdSchema } from './organization-members'

export const invitationAdmissionSchema = z.strictObject({ token: inviteTokenSchema })
export const invitationAdmissionResponseSchema = z.strictObject({
  credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime(),
  intent: acceptIntentSchema,
})
export const invitationContextSchema = z.strictObject({
  email: z.string(),
  expiresAt: z.iso.datetime(),
})
export const invitedRegisterSchema = registerSchema.omit({ email: true }).strict()
const organization = z.strictObject({ id: memberIdSchema, name: z.string() })
const descriptor = { inviteId: memberIdSchema, generation: inviteGenerationSchema, organization }
export const invitationInspectResponseSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('verify_email'), email: z.string() }),
  z.strictObject({
    state: z.literal('ready'),
    ...descriptor,
    roles: z
      .array(
        z.strictObject({
          id: memberIdSchema,
          name: z.string(),
          description: z.string().nullable(),
        })
      )
      .min(1)
      .max(20),
    expiresAt: z.iso.datetime(),
  }),
  z.strictObject({ state: z.literal('already_access'), ...descriptor }),
])
export type InvitationAdmission = z.infer<typeof invitationAdmissionResponseSchema>
export type InvitedRegisterInput = z.infer<typeof invitedRegisterSchema>
export type InvitationInspectResponse = z.infer<typeof invitationInspectResponseSchema>

export const invitationHandoffConfirmedSchema = z.strictObject({ status: z.literal('confirmed') })
export const invitationHandoffAbortedSchema = z.strictObject({ status: z.literal('aborted') })
