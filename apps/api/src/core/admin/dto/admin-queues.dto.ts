import { createZodDto } from 'nestjs-zod'

import { adminQueuesResponseSchema } from '@amcore/shared'

/** Console background-work queue summary response DTO — see `adminQueuesResponseSchema`. */
export class AdminQueuesResponseDto extends createZodDto(adminQueuesResponseSchema) {}
