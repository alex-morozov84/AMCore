import { createZodDto } from 'nestjs-zod'

import { createApiKeyResponseSchema } from '@amcore/shared'

/**
 * `POST /api-keys` response DTO (Arc C). Carries the one-time plaintext `key`
 * shown only at creation — never recoverable afterwards.
 */
export class CreateApiKeyResponseDto extends createZodDto(createApiKeyResponseSchema) {}
