import {
  adminOrganizationListResponseSchema,
  adminOrganizationResponseSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

/**
 * Admin organization response DTO (OA-08).
 *
 * Used with `@SchemaResponse` to strip any field outside the schema
 * allowlist from admin responses — paired with the Prisma `select` in
 * `AdminService` to keep `aclVersion` and other internal columns off
 * the wire.
 */
export class AdminOrganizationResponseDto extends createSchemaDto(
  adminOrganizationResponseSchema
) {}

/** Paginated admin organization list DTO. */
export class AdminOrganizationListResponseDto extends createSchemaDto(
  adminOrganizationListResponseSchema
) {}
