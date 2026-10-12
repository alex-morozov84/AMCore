import { updateUserSystemRoleSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

export class UpdateSystemRoleDto extends createSchemaDto(updateUserSystemRoleSchema) {}
