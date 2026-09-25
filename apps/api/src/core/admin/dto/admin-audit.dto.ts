import { createZodDto } from 'nestjs-zod'

import { adminAuditResponseSchema } from '@amcore/shared'

export class AdminAuditResponseDto extends createZodDto(adminAuditResponseSchema) {}
