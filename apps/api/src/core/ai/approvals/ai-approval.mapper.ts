import type { AiApprovalResponse } from '@amcore/shared'

import type { AiApproval, AiToolInvocation } from '@/generated/prisma/client'

/** Private approval projection with its single gated invocation. */
export type AiApprovalWithTool = AiApproval & {
  toolInvocations: (Pick<AiToolInvocation, 'toolId' | 'riskClass'> &
    Partial<
      Pick<
        AiToolInvocation,
        | 'toolVersion'
        | 'intentSnapshot'
        | 'intentHash'
        | 'argsSnapshot'
        | 'id'
        | 'originCall'
        | 'inputSchemaHash'
        | 'normalizedSchemaHash'
        | 'idempotency'
      >
    >)[]
}

/** Public metadata defaults to redacted; the service separately authorizes preview disclosure. */
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
    toolVersion: tool?.toolVersion ?? null,
    intentHash: approval.intentHash,
    preview: null,
    disclosure: approval.intentHash ? 'unavailable' : 'legacy',
    requestedReason: approval.requestedReason,
    expiresAt: approval.expiresAt?.toISOString() ?? null,
    decidedAt: approval.decidedAt?.toISOString() ?? null,
    createdAt: approval.createdAt.toISOString(),
  }
}

/** Closed private select for authority checks; never spread this row into a DTO. */
export const APPROVAL_TOOL_SELECT = {
  id: true,
  toolId: true,
  riskClass: true,
  toolVersion: true,
  inputSchemaHash: true,
  normalizedSchemaHash: true,
  idempotency: true,
  intentSnapshot: true,
  intentHash: true,
  argsSnapshot: true,
  originCall: true,
} as const
