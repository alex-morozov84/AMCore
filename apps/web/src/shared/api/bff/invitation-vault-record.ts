import {
  acceptIntentSchema,
  invitationAdmissionResponseSchema,
  invitationFlowBindingSchema,
  invitationFlowIdSchema,
  invitationSessionBindingSchema,
} from '@amcore/shared'
import { z } from 'zod'

import 'server-only'

const authAttemptSchema = z.strictObject({
  id: invitationFlowIdSchema,
  fence: invitationFlowIdSchema,
  kind: z.enum(['login', 'register', 'oauth', 'switch']),
  provider: z.enum(['google', 'github', 'apple']).nullable(),
  ownerEpoch: z.number().int().nonnegative(),
  reservedRevision: z.number().int().positive(),
  expectedSessionBinding: invitationSessionBindingSchema.nullable(),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  started: z.boolean(),
  cleanupKey: invitationAdmissionResponseSchema.shape.credential,
})
const handoffJournalSchema = z.strictObject({
  attemptId: invitationFlowIdSchema,
  cleanupKey: invitationAdmissionResponseSchema.shape.credential,
  newSessionId: z.string().min(1).max(128),
  backendSessionId: z.string().min(1).max(128),
  deadline: z.number().int(),
  confirmed: z.boolean(),
  ticketHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .optional(),
})
export const invitationVaultFlowSchema = z.strictObject({
  binding: invitationFlowBindingSchema,
  intent: acceptIntentSchema,
  credential: invitationAdmissionResponseSchema.shape.credential,
  expiresAt: z.number().int(),
  locale: z.string().max(16),
  state: z.enum(['active', 'authenticating', 'completing_signin', 'retired']),
  attempt: authAttemptSchema.nullable(),
  handoff: handoffJournalSchema.nullable(),
})
export const invitationOwnerRecordSchema = z.strictObject({
  version: z.number().int().positive(),
  origin: z.url(),
  expiresAt: z.number().int(),
  epoch: z.number().int().nonnegative(),
  sessionBinding: invitationSessionBindingSchema.nullable(),
  admissionsStartedAt: z.number().int(),
  admissions: z.number().int().nonnegative().max(20),
  flows: z.array(invitationVaultFlowSchema).max(5),
  pendingOAuthAttemptId: invitationFlowIdSchema.nullable(),
})
export type InvitationVaultFlow = z.infer<typeof invitationVaultFlowSchema>
export type InvitationOwnerRecord = z.infer<typeof invitationOwnerRecordSchema>
