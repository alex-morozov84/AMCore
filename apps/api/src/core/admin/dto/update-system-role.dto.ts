import { updateUserSystemRoleSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class UpdateSystemRoleDto extends createSchemaDto(updateUserSystemRoleSchema) {}
