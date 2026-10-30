import { z } from 'zod'

import type { MfaFlow, Prisma } from '../../../generated/prisma/client.js'

import type { LockedMfaFlow } from './mfa-flow-lock.js'
import { type FlowProofs, flowProofsSchema } from './mfa-flow-proofs.js'

export class ExpiredDuringVerification extends Error {}

export function flowData(data: Prisma.JsonValue): Prisma.JsonObject {
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
}

export function readFlowProofs(data: Prisma.JsonValue): FlowProofs {
  const parsed = flowProofsSchema.safeParse(flowData(data).proofs)
  return parsed.success ? parsed.data : { primary: null, secondFactor: null }
}

/** Reauthentication can tighten the ten-minute ceiling; this policy is recorded by the server. */
export function flowProofWindowSeconds(flow: Pick<MfaFlow, 'purpose' | 'data'>): number {
  if (flow.purpose !== 'reauthenticate') return 600
  const value = flowData(flow.data).proofWindowSeconds
  if (value === undefined) return 600
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 600)
    return value
  throw new Error('Invalid reauthentication proof window')
}

/** A caller must abort the enclosing tx so an expired proof cannot remain consumed. */
export function assertFlowDeadline(locked: LockedMfaFlow, now: Date): void {
  if (
    locked.flow.expiresAt <= now ||
    (locked.context && locked.context.expiresAt <= now) ||
    (locked.source && locked.source.expiresAt <= now)
  )
    throw new ExpiredDuringVerification()
}

/** OAuth identity is local to this flow and never substitutes for a protected account's password. */
export const oauthFlowIdentitySchema = z
  .object({
    method: z.literal('oauth'),
    eventId: z.string().uuid(),
    verifiedAt: z.iso.datetime(),
    securityVersion: z.number().int().nonnegative(),
  })
  .strict()
export function freshOAuthFlowIdentity(
  data: Prisma.JsonValue,
  securityVersion: number,
  now: Date
): boolean {
  const identity = oauthFlowIdentitySchema.safeParse(flowData(data).identity)
  if (!identity.success || identity.data.securityVersion !== securityVersion) return false
  const age = now.getTime() - new Date(identity.data.verifiedAt).getTime()
  return age >= 0 && age <= 300_000
}
