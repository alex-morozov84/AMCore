import { createZodDto } from 'nestjs-zod'

import {
  adminOrganizationDetailQuerySchema,
  adminOrganizationDetailResponseSchema,
  adminUserDetailQuerySchema,
  adminUserDetailResponseSchema,
} from '@amcore/shared'

export class AdminUserDetailQueryDto extends createZodDto(adminUserDetailQuerySchema) {}
export class AdminOrganizationDetailQueryDto extends createZodDto(
  adminOrganizationDetailQuerySchema
) {}
export class AdminUserDetailResponseDto extends createZodDto(adminUserDetailResponseSchema) {}
export class AdminOrganizationDetailResponseDto extends createZodDto(
  adminOrganizationDetailResponseSchema
) {}
