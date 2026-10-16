import {
  organizationBootstrapResultSchema,
  organizationBootstrapSchema,
  organizationCreationPolicySchema,
  organizationCreationResultSchema,
  organizationPrepareAccountSchema,
  organizationPreparedAccountSchema,
  organizationSetupAccountSchema,
  organizationSetupStatusSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class OrganizationCreationPolicyDto extends createSchemaDto(
  organizationCreationPolicySchema
) {}
export class OrganizationCreationResultDto extends createSchemaDto(
  organizationCreationResultSchema
) {}
export class OrganizationSetupStatusDto extends createSchemaDto(organizationSetupStatusSchema) {}
export class OrganizationPrepareAccountDto extends createSchemaDto(
  organizationPrepareAccountSchema
) {}
export class OrganizationPreparedAccountDto extends createSchemaDto(
  organizationPreparedAccountSchema
) {}
export class OrganizationSetupAccountDto extends createSchemaDto(organizationSetupAccountSchema) {}
export class OrganizationBootstrapDto extends createSchemaDto(organizationBootstrapSchema) {}
export class OrganizationBootstrapResultDto extends createSchemaDto(
  organizationBootstrapResultSchema
) {}
