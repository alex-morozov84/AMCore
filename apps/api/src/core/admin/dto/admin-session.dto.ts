import { createZodDto } from 'nestjs-zod'

import { adminSessionsListResponseSchema, adminSessionsQuerySchema } from '@amcore/shared'

export class AdminSessionsQueryDto extends createZodDto(adminSessionsQuerySchema) {}
export class AdminSessionsListResponseDto extends createZodDto(adminSessionsListResponseSchema) {}
