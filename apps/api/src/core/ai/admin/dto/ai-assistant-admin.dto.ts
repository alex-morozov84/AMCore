import {
  aiAssistantListQuerySchema,
  aiAssistantListResponseSchema,
  aiAssistantResponseSchema,
  createAiAssistantSchema,
  publishAiAssistantVersionSchema,
  updateAiAssistantSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../../common/schemas/schema-dto'

/**
 * Assistant-admin HTTP DTOs (Track C — ADR-054, Arc F.1). Thin `createSchemaDto` wrappers over the
 * shared contracts (ADR-050 typed surface) — the schemas are the single source of truth.
 */
export class AiAssistantResponseDto extends createSchemaDto(aiAssistantResponseSchema) {}
export class AiAssistantListQueryDto extends createSchemaDto(aiAssistantListQuerySchema) {}
export class AiAssistantListResponseDto extends createSchemaDto(aiAssistantListResponseSchema) {}
export class CreateAiAssistantDto extends createSchemaDto(createAiAssistantSchema) {}
export class PublishAiAssistantVersionDto extends createSchemaDto(publishAiAssistantVersionSchema) {}
export class UpdateAiAssistantDto extends createSchemaDto(updateAiAssistantSchema) {}
