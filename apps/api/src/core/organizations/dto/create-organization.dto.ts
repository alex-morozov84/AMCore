import { createZodDto } from 'nestjs-zod'

import { createOrganizationSchema } from '@amcore/shared'

export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}
