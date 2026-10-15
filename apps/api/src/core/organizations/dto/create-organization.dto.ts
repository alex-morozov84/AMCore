import { createOrganizationSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class CreateOrganizationDto extends createSchemaDto(createOrganizationSchema) {}
