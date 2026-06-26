import type { AiConversation, AiRun } from '@prisma/client'

import type {
  AiConversationControlValue,
  AiConversationResponse,
  AiConversationStateValue,
  AiRunResponse,
  AiRunStatusValue,
} from '@amcore/shared'

/**
 * DB → wire projections for the AI run/conversation surface (Track C — ADR-054, Arc C). The wire
 * lifecycle enums are the lowercase projection of the Prisma SCREAMING_CASE tokens (`ai-enums`), so
 * a faithful, total projection is a `toLowerCase()` — the API never leaks DB enum casing. Neither
 * projection exposes the internal `modelSnapshot`/lease/retry columns; the run response is the
 * minimal Arc A `aiRunResponseSchema` shape, extended additively by later arcs.
 */

export function toAiRunResponse(run: AiRun): AiRunResponse {
  return {
    id: run.id,
    conversationId: run.conversationId,
    status: run.status.toLowerCase() as AiRunStatusValue,
    errorCode: run.errorCode,
    terminalReasonCode: run.terminalReasonCode,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  }
}

export function toAiConversationResponse(conversation: AiConversation): AiConversationResponse {
  return {
    id: conversation.id,
    assistantId: conversation.assistantId,
    title: conversation.title,
    state: conversation.state.toLowerCase() as AiConversationStateValue,
    controlledBy: conversation.controlledBy.toLowerCase() as AiConversationControlValue,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    closedAt: conversation.closedAt?.toISOString() ?? null,
  }
}
