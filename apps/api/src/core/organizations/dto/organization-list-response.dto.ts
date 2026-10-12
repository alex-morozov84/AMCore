import { organizationListResponseSchema, roleListResponseSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

/**
 * Paginated list response DTOs for `/organizations` and
 * `/organizations/:id/roles` (ADR-036 / OB-05).
 *
 * Used with `@SchemaResponse` so any field outside the canonical
 * envelope is stripped at the transport layer.
 */
export class OrganizationListResponseDto extends createSchemaDto(organizationListResponseSchema) {}

export class RoleListResponseDto extends createSchemaDto(roleListResponseSchema) {}
