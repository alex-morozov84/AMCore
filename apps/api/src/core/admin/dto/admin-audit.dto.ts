import { adminAuditResponseSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class AdminAuditResponseDto extends createSchemaDto(adminAuditResponseSchema) {}
