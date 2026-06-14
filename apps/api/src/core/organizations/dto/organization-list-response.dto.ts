import { createZodDto } from 'nestjs-zod'

import { organizationListResponseSchema, roleListResponseSchema } from '@amcore/shared'

/**
 * Paginated list response DTOs for `/organizations` and
 * `/organizations/:id/roles` (ADR-036 / OB-05).
 *
 * Used with `@ZodResponse` so any field outside the canonical
 * envelope is stripped at the transport layer.
 */
export class OrganizationListResponseDto extends createZodDto(organizationListResponseSchema) {}

export class RoleListResponseDto extends createZodDto(roleListResponseSchema) {}
