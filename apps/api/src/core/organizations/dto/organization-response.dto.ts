import {
  orgResponseSchema,
  orgRoleResponseSchema,
  permissionResponseSchema,
  switchOrgResponseSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

/**
 * Single-resource response DTOs for the organizations surface (Arc C).
 *
 * Used with `@SchemaResponse`; the schemas use ISO-string date fields, so the
 * services must map their Prisma rows (Date → `toISOString()`) before
 * returning — see `OrganizationsService`/`RoleService` mappers.
 */
export class OrgResponseDto extends createSchemaDto(orgResponseSchema) {}
export class SwitchOrgResponseDto extends createSchemaDto(switchOrgResponseSchema) {}
export class OrgRoleResponseDto extends createSchemaDto(orgRoleResponseSchema) {}
export class PermissionResponseDto extends createSchemaDto(permissionResponseSchema) {}
