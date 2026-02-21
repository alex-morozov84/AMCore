import { createZodDto } from 'nestjs-zod'

import { updateOrganizationSchema } from '@amcore/shared'

export class UpdateOrganizationDto extends createZodDto(updateOrganizationSchema) {}
