import { createZodDto } from 'nestjs-zod'

import { adminUserListQuerySchema } from '@amcore/shared'

export class AdminUserListQueryDto extends createZodDto(adminUserListQuerySchema) {}
