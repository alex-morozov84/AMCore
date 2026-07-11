import type { AiApproval, AiToolInvocation } from '@prisma/client'

import type { AiApprovalResponse } from '@amcore/shared'

/** An approval with the one tool invocation it gates (v1 is one-per-approval) — id + risk only. */
export type AiApprovalWithTool = AiApproval & {
  toolInvocations: Pick<AiToolInvocation, 'toolId' | 'riskClass'>[]
}

/**
 * Project a persisted approval to its content-free wire response (Track C — ADR-054, Arc E.5). The
 * owner sees WHAT they are gating — the tool id + risk class + a bounded requested reason — never the
 * tool arguments, prompt, or model output. Enum values are lowercased to the wire vocabulary.
 */
export function toAiApprovalResponse(approval: AiApprovalWithTool): AiApprovalResponse {
  const tool = approval.toolInvocations[0]
  return {
    id: approval.id,
    runId: approval.runId,
    conversationId: approval.conversationId,
    kind: approval.kind.toLowerCase() as AiApprovalResponse['kind'],
    state: approval.state.toLowerCase() as AiApprovalResponse['state'],
    toolId: tool?.toolId ?? null,
    riskClass: (tool?.riskClass.toLowerCase() as AiApprovalResponse['riskClass']) ?? null,
    requestedReason: approval.requestedReason,
    expiresAt: approval.expiresAt?.toISOString() ?? null,
    decidedAt: approval.decidedAt?.toISOString() ?? null,
    createdAt: approval.createdAt.toISOString(),
  }
}
