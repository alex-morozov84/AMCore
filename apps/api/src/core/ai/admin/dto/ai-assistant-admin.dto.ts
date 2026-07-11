import { createZodDto } from 'nestjs-zod'

import {
  aiAssistantListQuerySchema,
  aiAssistantListResponseSchema,
  aiAssistantResponseSchema,
  createAiAssistantSchema,
  publishAiAssistantVersionSchema,
  updateAiAssistantSchema,
} from '@amcore/shared'

/**
 * Assistant-admin HTTP DTOs (Track C — ADR-054, Arc F.1). Thin `createZodDto` wrappers over the
 * shared contracts (ADR-050 typed surface) — the schemas are the single source of truth.
 */
export class AiAssistantResponseDto extends createZodDto(aiAssistantResponseSchema) {}
export class AiAssistantListQueryDto extends createZodDto(aiAssistantListQuerySchema) {}
export class AiAssistantListResponseDto extends createZodDto(aiAssistantListResponseSchema) {}
export class CreateAiAssistantDto extends createZodDto(createAiAssistantSchema) {}
export class PublishAiAssistantVersionDto extends createZodDto(publishAiAssistantVersionSchema) {}
export class UpdateAiAssistantDto extends createZodDto(updateAiAssistantSchema) {}
