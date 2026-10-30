import type { AuthSessionFamily } from '../../../generated/prisma/client.js'

import { type FlowProofs, flowProofsSchema } from './mfa-flow-proofs.js'

/** A reference retains the actual F event identity/time; it never invents a local verification. */
export function familyProofReferences(family: AuthSessionFamily): FlowProofs {
  const origin = { kind: 'family' as const, familyId: family.id }
  const primary =
    family.primaryMethod === 'password' && family.primaryAt && family.primaryProofId
      ? {
          eventId: family.primaryProofId,
          verifiedAt: family.primaryAt.toISOString(),
          method: 'password',
          origin,
        }
      : null
  const secondFactor =
    family.mfaAt && family.mfaProofId && family.factorVersion
      ? {
          eventId: family.mfaProofId,
          verifiedAt: family.mfaAt.toISOString(),
          method: family.mfaMethod,
          factorVersion: family.factorVersion,
          origin,
          ...(family.recoveryGeneration !== null
            ? { recoveryGeneration: family.recoveryGeneration }
            : {}),
        }
      : null
  const schema = flowProofsSchema.shape
  return {
    primary: schema.primary.safeParse(primary).data ?? null,
    secondFactor: schema.secondFactor.safeParse(secondFactor).data ?? null,
  }
}
