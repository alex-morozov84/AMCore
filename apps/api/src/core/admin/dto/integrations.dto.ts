import {
  integrationsResponseSchema,
  probePreparationSchema,
  probeReceiptSchema,
  probeRequestSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class IntegrationsResponseDto extends createSchemaDto(integrationsResponseSchema) {}
export class ProbePreparationDto extends createSchemaDto(probePreparationSchema) {}
export class ProbeReceiptDto extends createSchemaDto(probeReceiptSchema) {}
export class ProbeRequestDto extends createSchemaDto(probeRequestSchema) {}
