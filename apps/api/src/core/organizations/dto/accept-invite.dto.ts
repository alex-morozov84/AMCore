import { acceptInviteSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export const AcceptInviteDto = createSchemaDto(acceptInviteSchema, 'AcceptInviteDto')
