import {
  adminOrganizationDetailQuerySchema,
  adminOrganizationDetailResponseSchema,
  adminUserDetailQuerySchema,
  adminUserDetailResponseSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

export class AdminUserDetailQueryDto extends createSchemaDto(adminUserDetailQuerySchema) {}
export class AdminOrganizationDetailQueryDto extends createSchemaDto(
  adminOrganizationDetailQuerySchema
) {}
export class AdminUserDetailResponseDto extends createSchemaDto(adminUserDetailResponseSchema) {}
export class AdminOrganizationDetailResponseDto extends createSchemaDto(
  adminOrganizationDetailResponseSchema
) {}
