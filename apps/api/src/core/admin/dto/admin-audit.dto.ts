import { createZodDto } from 'nestjs-zod'

import { adminAuditQuerySchema, adminAuditResponseSchema } from '@amcore/shared'

export class AdminAuditQueryDto extends createZodDto(adminAuditQuerySchema) {}
export class AdminAuditResponseDto extends createZodDto(adminAuditResponseSchema) {}
