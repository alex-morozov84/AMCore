import { createZodDto } from 'nestjs-zod'

import { organizationContextResponseSchema } from '@amcore/shared'

export class OrganizationContextResponseDto extends createZodDto(
  organizationContextResponseSchema
) {}
