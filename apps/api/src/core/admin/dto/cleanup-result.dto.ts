import { cleanupResultSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

/**
 * `POST /admin/cleanup` response DTO (Arc C). Per-type expired-record counts
 * plus the `failures` list (EQS-04).
 */
export class CleanupResultDto extends createSchemaDto(cleanupResultSchema) {}
