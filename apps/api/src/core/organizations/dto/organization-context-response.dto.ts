import { organizationContextResponseSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

export class OrganizationContextResponseDto extends createSchemaDto(
  organizationContextResponseSchema
) {}
