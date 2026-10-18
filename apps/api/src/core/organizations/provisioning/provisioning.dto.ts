import {
  provisioningCancelSchema,
  provisioningCommandReceiptSchema,
  provisioningCreateSchema,
  provisioningLookupSchema,
  provisioningPolicySchema,
  provisioningProgressSchema,
  provisioningReceiptSchema,
  provisioningReissueSchema,
  provisioningReplaceSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class ProvisioningCreateDto extends createSchemaDto(provisioningCreateSchema) {}
export class ProvisioningCancelDto extends createSchemaDto(provisioningCancelSchema) {}
export class ProvisioningReissueDto extends createSchemaDto(provisioningReissueSchema) {}
export class ProvisioningReplaceDto extends createSchemaDto(provisioningReplaceSchema) {}
export class ProvisioningReceiptDto extends createSchemaDto(provisioningReceiptSchema) {}
export class ProvisioningCommandReceiptDto extends createSchemaDto(
  provisioningCommandReceiptSchema
) {}
export class ProvisioningPolicyDto extends createSchemaDto(provisioningPolicySchema) {}
export const ProvisioningLookupDto = createSchemaDto(
  provisioningLookupSchema,
  'ProvisioningLookupDto'
)
export class ProvisioningProgressDto extends createSchemaDto(provisioningProgressSchema) {}
