import { createZodDto } from 'nestjs-zod'

import { cleanupResultSchema } from '@amcore/shared'

/**
 * `POST /admin/cleanup` response DTO (Arc C). Per-type expired-record counts
 * plus the `failures` list (EQS-04).
 */
export class CleanupResultDto extends createZodDto(cleanupResultSchema) {}
