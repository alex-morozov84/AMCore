import { apiKeyListResponseSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

/**
 * Paginated `GET /api-keys` response DTO (ADR-036 / OB-05).
 */
export class ApiKeyListResponseDto extends createSchemaDto(apiKeyListResponseSchema) {}
