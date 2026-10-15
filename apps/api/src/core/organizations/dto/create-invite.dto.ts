import { createInviteSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class CreateInviteDto extends createSchemaDto(createInviteSchema) {}
