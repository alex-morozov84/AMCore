import type { BrowserAuthContext, Prisma } from '../../../generated/prisma/client.js'

/** Read under the context lock, before acquiring sorted old/new account locks. */
export async function browserLoginParticipants(
  tx: Prisma.TransactionClient,
  context: BrowserAuthContext
): Promise<{
  owners: string[]
  familyIds: string[]
} | null> {
  const families = await tx.authSessionFamily.findMany({
    where: { browserContextId: context.id, publicationGeneration: context.generation },
    select: { id: true, userId: true },
  })
  const flows = await tx.mfaFlow.findMany({
    where: {
      browserContextId: context.id,
      publicationGeneration: context.generation,
      state: { in: ['open', 'committed'] },
    },
    select: { userId: true },
  })
  if (
    context.currentFamilyId &&
    !families.some((family) => family.id === context.currentFamilyId)
  ) {
    if (
      await tx.authSessionFamily.findUnique({
        where: { id: context.currentFamilyId },
        select: { id: true },
      })
    )
      return null
  }
  if (context.reservedFlowId) {
    const reserved = await tx.mfaFlow.findUnique({
      where: { id: context.reservedFlowId },
      select: { browserContextId: true, publicationGeneration: true },
    })
    if (
      reserved &&
      (reserved.browserContextId !== context.id ||
        reserved.publicationGeneration !== context.generation)
    )
      return null
  }
  return {
    owners: [...new Set([...families, ...flows].map((row) => row.userId))].sort(),
    familyIds: families.map((row) => row.id),
  }
}
