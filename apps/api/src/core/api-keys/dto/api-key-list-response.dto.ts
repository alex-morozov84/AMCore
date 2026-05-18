import { createZodDto } from 'nestjs-zod'

import { apiKeyListResponseSchema } from '@amcore/shared'

/**
 * Paginated `GET /api-keys` response DTO (ADR-036 / OB-05).
 */
export class ApiKeyListResponseDto extends createZodDto(apiKeyListResponseSchema) {}
