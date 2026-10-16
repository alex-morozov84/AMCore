import { updateRoleSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class UpdateRoleDto extends createSchemaDto(updateRoleSchema) {}
