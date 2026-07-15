import { createZodDto } from 'nestjs-zod'

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

/**
 * AI run/conversation HTTP DTOs (Track C — ADR-054, Arc C). Thin `createZodDto` wrappers over the
 * shared Arc A contracts (ADR-050 typed surface); the schemas are the single source of truth, so no
 * shape is redeclared here. List/cancel/SSE DTOs arrive in their own increments (C.2/C.5).
 */
export class CreateAiConversationDto extends createZodDto(createAiConversationSchema) {}
export class AiConversationResponseDto extends createZodDto(aiConversationResponseSchema) {}
// Multimodal artifact upload (Track C — ADR-054, Arc G).
export class AiArtifactResponseDto extends createZodDto(aiArtifactResponseSchema) {}
// Human takeover / operator review (Track C — ADR-054, Arc F.3).
export class TakeoverConversationDto extends createZodDto(takeoverConversationSchema) {}
export class ReleaseConversationDto extends createZodDto(releaseConversationSchema) {}
export class PostOperatorMessageDto extends createZodDto(postOperatorMessageSchema) {}
export class AiTranscriptQueryDto extends createZodDto(aiTranscriptQuerySchema) {}
export class AiTranscriptResponseDto extends createZodDto(aiTranscriptResponseSchema) {}
export class AiMessageResponseDto extends createZodDto(aiMessageResponseSchema) {}
export class CreateAiRunDto extends createZodDto(createAiRunSchema) {}
export class AiRunResponseDto extends createZodDto(aiRunResponseSchema) {}
export class AiRunListQueryDto extends createZodDto(aiRunListQuerySchema) {}
export class AiRunPageDto extends createZodDto(aiRunPageSchema) {}
export class AiRunCancelResponseDto extends createZodDto(aiRunCancelResponseSchema) {}
// Human-in-the-loop approvals (Track C — ADR-054, Arc E.5).
export class AiApprovalListQueryDto extends createZodDto(aiApprovalListQuerySchema) {}
export class AiApprovalListResponseDto extends createZodDto(aiApprovalListResponseSchema) {}
export class AiApprovalResponseDto extends createZodDto(aiApprovalResponseSchema) {}
export class DecideAiApprovalDto extends createZodDto(decideAiApprovalSchema) {}
