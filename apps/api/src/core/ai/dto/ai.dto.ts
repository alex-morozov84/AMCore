import { createZodDto } from 'nestjs-zod'

import {
  aiConversationResponseSchema,
  aiRunCancelResponseSchema,
  aiRunListQuerySchema,
  aiRunPageSchema,
  aiRunResponseSchema,
  createAiConversationSchema,
  createAiRunSchema,
} from '@amcore/shared'

/**
 * AI run/conversation HTTP DTOs (Track C — ADR-054, Arc C). Thin `createZodDto` wrappers over the
 * shared Arc A contracts (ADR-050 typed surface); the schemas are the single source of truth, so no
 * shape is redeclared here. List/cancel/SSE DTOs arrive in their own increments (C.2/C.5).
 */
export class CreateAiConversationDto extends createZodDto(createAiConversationSchema) {}
export class AiConversationResponseDto extends createZodDto(aiConversationResponseSchema) {}
export class CreateAiRunDto extends createZodDto(createAiRunSchema) {}
export class AiRunResponseDto extends createZodDto(aiRunResponseSchema) {}
export class AiRunListQueryDto extends createZodDto(aiRunListQuerySchema) {}
export class AiRunPageDto extends createZodDto(aiRunPageSchema) {}
export class AiRunCancelResponseDto extends createZodDto(aiRunCancelResponseSchema) {}
