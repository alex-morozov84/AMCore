import { adminUserListQuerySchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class AdminUserListQueryDto extends createSchemaDto(adminUserListQuerySchema) {}
