import { adminSessionsListResponseSchema, adminSessionsQuerySchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

export class AdminSessionsQueryDto extends createSchemaDto(adminSessionsQuerySchema) {}
export class AdminSessionsListResponseDto extends createSchemaDto(
  adminSessionsListResponseSchema
) {}
