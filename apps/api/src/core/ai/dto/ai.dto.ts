import {
  aiApprovalListQuerySchema,
  aiApprovalListResponseSchema,
  aiApprovalResponseSchema,
  aiArtifactResponseSchema,
  aiConversationResponseSchema,
  aiMessageResponseSchema,
  aiRunCancelResponseSchema,
  aiRunListQuerySchema,
  aiRunPageSchema,
  aiRunResponseSchema,
  aiTranscriptQuerySchema,
  aiTranscriptResponseSchema,
  createAiConversationSchema,
  createAiRunSchema,
  decideAiApprovalSchema,
  postOperatorMessageSchema,
  releaseConversationSchema,
  takeoverConversationSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

/**
 * AI run/conversation HTTP DTOs (Track C — ADR-054, Arc C). Thin `createSchemaDto` wrappers over the
 * shared Arc A contracts (ADR-050 typed surface); the schemas are the single source of truth, so no
 * shape is redeclared here. List/cancel/SSE DTOs arrive in their own increments (C.2/C.5).
 */
export class CreateAiConversationDto extends createSchemaDto(createAiConversationSchema) {}
export class AiConversationResponseDto extends createSchemaDto(aiConversationResponseSchema) {}
// Multimodal artifact upload (Track C — ADR-054, Arc G).
export class AiArtifactResponseDto extends createSchemaDto(aiArtifactResponseSchema) {}
// Human takeover / operator review (Track C — ADR-054, Arc F.3).
export class TakeoverConversationDto extends createSchemaDto(takeoverConversationSchema) {}
export class ReleaseConversationDto extends createSchemaDto(releaseConversationSchema) {}
export class PostOperatorMessageDto extends createSchemaDto(postOperatorMessageSchema) {}
export class AiTranscriptQueryDto extends createSchemaDto(aiTranscriptQuerySchema) {}
export class AiTranscriptResponseDto extends createSchemaDto(aiTranscriptResponseSchema) {}
export class AiMessageResponseDto extends createSchemaDto(aiMessageResponseSchema) {}
export class CreateAiRunDto extends createSchemaDto(createAiRunSchema) {}
export class AiRunResponseDto extends createSchemaDto(aiRunResponseSchema) {}
export class AiRunListQueryDto extends createSchemaDto(aiRunListQuerySchema) {}
export class AiRunPageDto extends createSchemaDto(aiRunPageSchema) {}
export class AiRunCancelResponseDto extends createSchemaDto(aiRunCancelResponseSchema) {}
// Human-in-the-loop approvals (Track C — ADR-054, Arc E.5).
export class AiApprovalListQueryDto extends createSchemaDto(aiApprovalListQuerySchema) {}
export class AiApprovalListResponseDto extends createSchemaDto(aiApprovalListResponseSchema) {}
export class AiApprovalResponseDto extends createSchemaDto(aiApprovalResponseSchema) {}
export class DecideAiApprovalDto extends createSchemaDto(decideAiApprovalSchema) {}
