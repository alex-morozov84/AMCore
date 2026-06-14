import { createZodDto } from 'nestjs-zod'

import {
  orgResponseSchema,
  orgRoleResponseSchema,
  permissionResponseSchema,
  switchOrgResponseSchema,
} from '@amcore/shared'

/**
 * Single-resource response DTOs for the organizations surface (Arc C).
 *
 * Used with `@ZodResponse`; the schemas use ISO-string date fields, so the
 * services must map their Prisma rows (Date → `toISOString()`) before
 * returning — see `OrganizationsService`/`RoleService` mappers.
 */
export class OrgResponseDto extends createZodDto(orgResponseSchema) {}
export class SwitchOrgResponseDto extends createZodDto(switchOrgResponseSchema) {}
export class OrgRoleResponseDto extends createZodDto(orgRoleResponseSchema) {}
export class PermissionResponseDto extends createZodDto(permissionResponseSchema) {}
