import { z } from 'zod'

import type { MfaEvidence } from './mfa-policy.js'

const origin = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('flow'), flowId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('family'), familyId: z.string().min(1) }).strict(),
])
const event = z
  .object({
    eventId: z.string().uuid(),
    verifiedAt: z.iso.datetime(),
    origin,
  })
  .strict()
const primary = event.extend({ method: z.literal('password') }).strict()
const secondFactor = event
  .extend({
    method: z.enum(['totp', 'recovery_code']),
    factorVersion: z.number().int().positive(),
    recoveryGeneration: z.number().int().positive().optional(),
  })
  .strict()

/** Internal durable data, never an HTTP request schema or a client assertion. */
export const flowProofsSchema = z
  .object({
    primary: primary.nullable(),
    secondFactor: secondFactor.nullable(),
  })
  .strict()
export type FlowProofs = z.infer<typeof flowProofsSchema>

export interface ProofResolution {
  flowId: string
  sourceFamilyId: string | null
  source: (MfaEvidence & { id: string; primaryMethod: string }) | null
  codeGeneration: number
}

/** Family references are reevaluated ONLY against the exact locked source F. */
export function resolveFlowProofs(data: unknown, scope: ProofResolution): MfaEvidence {
  const result: MfaEvidence = {
    primaryAt: null,
    primaryProofId: null,
    mfaAt: null,
    mfaProofId: null,
    mfaMethod: null,
    factorVersion: null,
  }
  const parsed = flowProofsSchema.safeParse(data)
  if (!parsed.success) return result
  const { primary: password, secondFactor: factor } = parsed.data
  if (password?.origin.kind === 'flow' && password.origin.flowId === scope.flowId) {
    result.primaryAt = new Date(password.verifiedAt)
    result.primaryProofId = password.eventId
  } else if (
    password?.origin.kind === 'family' &&
    password.origin.familyId === scope.sourceFamilyId &&
    scope.source?.id === scope.sourceFamilyId &&
    scope.source?.primaryMethod === 'password'
  ) {
    result.primaryAt = scope.source.primaryAt
    result.primaryProofId = scope.source.primaryProofId
  }
  if (
    factor?.origin.kind === 'flow' &&
    factor.origin.flowId === scope.flowId &&
    (factor.method !== 'recovery_code' || factor.recoveryGeneration === scope.codeGeneration)
  ) {
    result.mfaAt = new Date(factor.verifiedAt)
    result.mfaProofId = factor.eventId
    result.mfaMethod = factor.method
    result.factorVersion = factor.factorVersion
  } else if (
    factor?.origin.kind === 'family' &&
    factor.origin.familyId === scope.sourceFamilyId &&
    scope.source?.id === scope.sourceFamilyId &&
    scope.source
  ) {
    result.mfaAt = scope.source.mfaAt
    result.mfaProofId = scope.source.mfaProofId
    result.mfaMethod = scope.source.mfaMethod
    result.factorVersion = scope.source.factorVersion
  }
  return result
}
