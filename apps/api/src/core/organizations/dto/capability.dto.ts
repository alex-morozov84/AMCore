import { createZodDto } from 'nestjs-zod'

import { capabilityCatalogueResponseSchema, createPresetPermissionSchema } from '@amcore/shared'

export class CapabilityCatalogueResponseDto extends createZodDto(
  capabilityCatalogueResponseSchema
) {}
export class CreatePresetPermissionDto extends createZodDto(createPresetPermissionSchema) {}
