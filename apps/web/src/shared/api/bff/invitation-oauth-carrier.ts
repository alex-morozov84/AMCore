import { invitationFlowIdSchema, invitationOAuthCorrelationSchema, invitationSessionBindingSchema } from '@amcore/shared'
import { z } from 'zod'

import { invitationFlowChanged } from './invitation-flow-authority'
import type { InvitationOwnerRecord } from './invitation-vault-record'

import 'server-only'

export const invitationOAuthCarrierSchema = z.strictObject({
  attemptId: invitationFlowIdSchema,
  ownerHash: z.string().regex(/^[a-f0-9]{64}$/),
  origin: z.url(),
  flowId: invitationFlowIdSchema,
  reservedRevision: z.number().int().positive(),
  expectedSessionBinding: invitationSessionBindingSchema.nullable(),
  ownerEpoch: z.number().int().nonnegative(),
  provider: invitationOAuthCorrelationSchema.shape.provider,
  expectedInviteId: invitationOAuthCorrelationSchema.shape.expectedInviteId,
  expectedGeneration: invitationOAuthCorrelationSchema.shape.expectedGeneration,
  fence: invitationFlowIdSchema,
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  status: z.enum(['reserved', 'started', 'used']),
  ticketHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  backendSessionId: z.string().min(1).max(128).nullable(),
})
export type InvitationOAuthCarrier = z.infer<typeof invitationOAuthCarrierSchema>

/** Exact ID lookup and all stored bindings, never a first/last flow heuristic. */
export function invitationOAuthFlow(owner: InvitationOwnerRecord, carrier: InvitationOAuthCarrier,
  ownerHash: string, incomingSessionBinding: string | null, now: number) {
  const flow = owner.flows.find(candidate => candidate.binding.flowId === carrier.flowId)
  if (carrier.ownerHash !== ownerHash || carrier.origin !== owner.origin || carrier.expiresAt <= now ||
    carrier.status === 'used' || carrier.expectedSessionBinding !== null || incomingSessionBinding !== null ||
    owner.sessionBinding !== null || owner.pendingOAuthAttemptId !== carrier.attemptId ||
    carrier.ownerEpoch !== owner.epoch || !flow || flow.state !== 'authenticating' || flow.expiresAt <= now ||
    flow.binding.sessionBinding !== null || flow.binding.flowRevision !== carrier.reservedRevision ||
    flow.intent.expectedInviteId !== carrier.expectedInviteId || flow.intent.expectedGeneration !== carrier.expectedGeneration ||
    flow.attempt?.id !== carrier.attemptId || flow.attempt.fence !== carrier.fence ||
    flow.attempt.provider !== carrier.provider || flow.attempt.ownerEpoch !== owner.epoch ||
    flow.attempt.expectedSessionBinding !== carrier.expectedSessionBinding ||
    flow.attempt.reservedRevision !== carrier.reservedRevision ||
    flow.attempt.createdAt !== carrier.createdAt || flow.attempt.expiresAt !== carrier.expiresAt ||
    (carrier.status === 'started') !== flow.attempt.started)
    throw invitationFlowChanged()
  return flow
}
