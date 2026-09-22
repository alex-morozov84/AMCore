import { createZodDto } from 'nestjs-zod'

import { adminOrganizationListQuerySchema } from '@amcore/shared'

export class AdminOrganizationListQueryDto extends createZodDto(adminOrganizationListQuerySchema) {}
