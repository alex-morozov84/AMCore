import { createApiKeyResponseSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

/**
 * `POST /api-keys` response DTO (Arc C). Carries the one-time plaintext `key`
 * shown only at creation — never recoverable afterwards.
 */
export class CreateApiKeyResponseDto extends createSchemaDto(createApiKeyResponseSchema) {}
