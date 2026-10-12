import { updateRoleSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

export class UpdateRoleDto extends createSchemaDto(updateRoleSchema) {}
