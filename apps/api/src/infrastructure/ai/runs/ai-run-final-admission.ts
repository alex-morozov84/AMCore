import type { ClaimedRun } from './ai-run-dispatch.types'
import { type AiRunGuard, markIoStarted } from './ai-run-guard.service'
import type { RunPlan } from './ai-run-plan'
import type { AiRunTransitions } from './ai-run-transitions.service'

/** Already handled gate denial, distinct from provider failure/retry. */
export class FinalAdmissionDenied extends Error {}

export async function admitFinalProviderCall(
  guard: AiRunGuard,
  transitions: AiRunTransitions,
  claim: ClaimedRun,
  plan: RunPlan
): Promise<void> {
  const admission = await guard.admit(claim, async (tx) => {
    const row = await tx.aiConversation.findUnique({
      where: { id: claim.conversationId },
      select: { assistantId: true, assistant: { select: { enabled: true } } },
    })
    if (!row || row.assistantId !== plan.assistantId) return 'assistant_binding_changed'
    if (row.assistant?.enabled === false) return 'assistant_disabled'
    await markIoStarted(tx, claim)
    return null
  })
  if (admission.kind === 'ok' && admission.value === null) return
  if (admission.kind === 'stopped') await transitions.stop(claim, admission.cause)
  if (admission.kind === 'ok') await transitions.failed(claim, admission.value!)
  throw new FinalAdmissionDenied()
}
