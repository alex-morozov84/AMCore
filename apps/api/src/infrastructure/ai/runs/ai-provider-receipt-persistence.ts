import { AiRunStepType, type Prisma } from '../../../generated/prisma/client.js'
import type { AiProviderReceipt } from '../gateway/provider-receipt.js'
import { usageLedgerV2 } from '../usage/ai-usage-v2.js'

import type { ClaimedRun } from './ai-run-dispatch.types.js'
import { writeRunSteps } from './ai-run-loop-persistence.js'
import type { RunPlan } from './ai-run-plan.js'

/** Safe receipt and spend share the terminal guard's transaction, including stop outcomes. */
export async function writeProviderReceipt(
  tx: Prisma.TransactionClient,
  claim: ClaimedRun,
  plan: RunPlan,
  receipt: AiProviderReceipt
): Promise<void> {
  await writeRunSteps(tx, claim.id, [
    {
      type: AiRunStepType.PROVIDER_CALL,
      durationMs: receipt.durationMs,
      detail: {
        modelId: receipt.modelId,
        providerId: receipt.providerId,
        providerType: receipt.providerType,
        finishReason: receipt.finishReason,
        toolCallCount: receipt.toolCallCount,
      },
    },
  ])
  await tx.aiUsageLedger.create({
    data: {
      runId: claim.id,
      conversationId: claim.conversationId,
      userId: plan.attribution.userId,
      organizationId: plan.attribution.organizationId,
      modelSlug: plan.modelSlug,
      toolCalls: receipt.toolCallCount,
      ...usageLedgerV2(receipt.usage),
    },
  })
}
