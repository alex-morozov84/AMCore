import { capabilityCatalogueResponseSchema, createPresetPermissionSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class CapabilityCatalogueResponseDto extends createSchemaDto(
  capabilityCatalogueResponseSchema
) {}
export class CreatePresetPermissionDto extends createSchemaDto(createPresetPermissionSchema) {}
