import { adminOrganizationListQuerySchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class AdminOrganizationListQueryDto extends createSchemaDto(
  adminOrganizationListQuerySchema
) {}
