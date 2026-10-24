import {
  supportMailPreparationSchema,
  supportMailPrepareSchema,
  supportMailReceiptSchema,
  supportMailStatusSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class SupportMailPrepareDto extends createSchemaDto(supportMailPrepareSchema) {}
export class SupportMailPreparationDto extends createSchemaDto(supportMailPreparationSchema) {}
export const SupportMailReceiptDto = createSchemaDto(
  supportMailReceiptSchema,
  'SupportMailReceiptDto'
)
export class SupportMailStatusDto extends createSchemaDto(supportMailStatusSchema) {}
