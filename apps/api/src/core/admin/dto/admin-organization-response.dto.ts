import { createZodDto } from 'nestjs-zod'

import {
  adminOrganizationListResponseSchema,
  adminOrganizationResponseSchema,
} from '@amcore/shared'

/**
 * Admin organization response DTO (OA-08).
 *
 * Used with `@ZodResponse` to strip any field outside the schema
 * allowlist from admin responses — paired with the Prisma `select` in
 * `AdminService` to keep `aclVersion` and other internal columns off
 * the wire.
 */
export class AdminOrganizationResponseDto extends createZodDto(adminOrganizationResponseSchema) {}

/** Paginated admin organization list DTO. */
export class AdminOrganizationListResponseDto extends createZodDto(
  adminOrganizationListResponseSchema
) {}
