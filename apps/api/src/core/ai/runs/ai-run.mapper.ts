import type {
  AiArtifactResponse,
  AiConversationControlValue,
  AiConversationResponse,
  AiConversationStateValue,
  AiMessageContent,
  AiMessageResponse,
  AiRunResponse,
  AiRunStatusValue,
} from '@amcore/shared'

import type { AiArtifact, AiConversation, AiMessage, AiRun } from '@/generated/prisma/client'

/**
 * DB → wire projections for the AI run/conversation surface (Track C — ADR-054, Arc C). The wire
 * lifecycle enums are the lowercase projection of the Prisma SCREAMING_CASE tokens (`ai-enums`), so
 * a faithful, total projection is a `toLowerCase()` — the API never leaks DB enum casing. Neither
 * projection exposes the internal `modelSnapshot`/lease/retry columns; the run response is the
 * minimal Arc A `aiRunResponseSchema` shape, extended additively by later arcs.
 */

export function toAiRunResponse(
  run: AiRun,
  pendingApprovalId: string | null = null
): AiRunResponse {
  return {
    id: run.id,
    conversationId: run.conversationId,
    status: run.status.toLowerCase() as AiRunStatusValue,
    errorCode: run.errorCode,
    terminalReasonCode: run.terminalReasonCode,
    // Only the single-run fetch resolves the parked run's pending approval; list/create leave it null.
    pendingApprovalId,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  }
}

/**
 * DB → wire projection for a transcript message (Track C — ADR-054, Arc F.3b). `content` is stored as
 * the validated structured-parts JSON and re-validated by `@ZodResponse` on the way out. The wire
 * `role`/`authorType` are the lowercase projection of the Prisma SCREAMING_CASE tokens.
 */
export function toAiMessageResponse(message: AiMessage): AiMessageResponse {
  return {
    id: message.id,
    conversationId: message.conversationId,
    runId: message.runId,
    sequence: message.sequence,
    role: message.role.toLowerCase() as AiMessageResponse['role'],
    authorType: message.authorType.toLowerCase() as AiMessageResponse['authorType'],
    content: message.content as unknown as AiMessageContent,
    createdAt: message.createdAt.toISOString(),
  }
}

/**
 * DB → wire projection for a multimodal artifact (Track C — ADR-054, Arc G). `storageKey`/`hash`
 * never leave the server — the response is the Arc A `aiArtifactResponseSchema` shape, unchanged.
 */
export function toAiArtifactResponse(artifact: AiArtifact): AiArtifactResponse {
  return {
    id: artifact.id,
    kind: artifact.kind.toLowerCase() as AiArtifactResponse['kind'],
    contentType: artifact.contentType,
    sizeBytes: artifact.sizeBytes,
    trustLevel: artifact.trustLevel.toLowerCase() as AiArtifactResponse['trustLevel'],
    createdAt: artifact.createdAt.toISOString(),
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
