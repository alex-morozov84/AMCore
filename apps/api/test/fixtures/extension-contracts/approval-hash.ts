import type { PrismaService } from '../../../src/prisma'

/** Capture the displayed immutable action before the test races its decision against another writer. */
export async function approvalHash(prisma: PrismaService, id: string): Promise<string> {
  const approval = await prisma.aiApproval.findUniqueOrThrow({
    where: { id },
    select: { intentHash: true },
  })
  if (!approval.intentHash) throw new Error('fixture_approval_missing_intent_hash')
  return approval.intentHash
}
