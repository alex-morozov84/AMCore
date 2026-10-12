import { adminAuditResponseSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

export class AdminAuditResponseDto extends createSchemaDto(adminAuditResponseSchema) {}
