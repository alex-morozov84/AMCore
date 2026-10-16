import { updateOrganizationSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class UpdateOrganizationDto extends createSchemaDto(updateOrganizationSchema) {}
