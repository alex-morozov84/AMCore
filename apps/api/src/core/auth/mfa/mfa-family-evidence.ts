import type { Prisma } from '../../../generated/prisma/client.js'

import type { LockedMfaFlow } from './mfa-flow-lock.js'
import { flowData, readFlowProofs } from './mfa-flow-state.js'
import type { MfaEvidence } from './mfa-policy.js'

/** Caller has required current fresh proofs and the exact live source F under its account lock. */
export async function commitFamilyEvidence(
  tx: Prisma.TransactionClient,
  locked: LockedMfaFlow,
  evidence: MfaEvidence
): Promise<void> {
  const familyId = locked.source?.id
  if (!familyId || familyId !== locked.flow.sourceFamilyId) throw new Error('Source family missing')
  const proofs = readFlowProofs(locked.flow.data)
  const recoveryGeneration =
    evidence.mfaMethod === 'recovery_code'
      ? proofs.secondFactor?.origin.kind === 'flow'
        ? proofs.secondFactor.recoveryGeneration!
        : (await tx.authSessionFamily.findUniqueOrThrow({ where: { id: familyId } }))
            .recoveryGeneration
      : null
  await tx.authSessionFamily.update({
    where: { id: familyId },
    data: { ...evidence, primaryMethod: 'password', recoveryGeneration },
  })
  locked.flow = await tx.mfaFlow.update({
    where: { id: locked.flow.id },
    data: {
      data: {
        ...flowData(locked.flow.data),
        proofs: {
          primary: { ...proofs.primary!, origin: { kind: 'family', familyId } },
          secondFactor: { ...proofs.secondFactor!, origin: { kind: 'family', familyId } },
        },
      },
    },
  })
}
