import type { Prisma } from '../../../generated/prisma/client.js'

/** Caller holds the exact owner's account coordination lock. No account epoch or unrelated G changes. */
export async function revokeFamilyRows(
  tx: Prisma.TransactionClient,
  userId: string,
  familyId: string,
  reason: string,
  now: Date
): Promise<number> {
  await tx.authSessionFamily.updateMany({
    where: { id: familyId, userId, revokedAt: null },
    data: { revokedAt: now, publicationState: 'retired' },
  })
  const result = await tx.session.updateMany({
    where: { userId, familyId, revokedAt: null },
    data: { revokedAt: now, revocationReason: reason },
  })
  return result.count
}
