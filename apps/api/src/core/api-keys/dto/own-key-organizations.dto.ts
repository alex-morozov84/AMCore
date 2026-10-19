import { ownKeyOrganizationsQuerySchema, ownKeyOrganizationsSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'
export class OwnKeyOrganizationsQueryDto extends createSchemaDto(ownKeyOrganizationsQuerySchema) {}
export const OwnKeyOrganizationsDto = createSchemaDto(
  ownKeyOrganizationsSchema,
  'OwnKeyOrganizationsDto'
)
