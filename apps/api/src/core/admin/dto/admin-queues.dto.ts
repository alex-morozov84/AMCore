import { adminQueuesResponseSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

/** Console background-work queue summary response DTO — see `adminQueuesResponseSchema`. */
export class AdminQueuesResponseDto extends createSchemaDto(adminQueuesResponseSchema) {}
