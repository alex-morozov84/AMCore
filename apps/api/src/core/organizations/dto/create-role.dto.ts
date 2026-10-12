import { createRoleSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

export class CreateRoleDto extends createSchemaDto(createRoleSchema) {}
