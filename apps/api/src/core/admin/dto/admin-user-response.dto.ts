import { adminUserListResponseSchema, adminUserResponseSchema } from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

/**
 * Admin user response DTO (OA-07).
 *
 * Used with `@SchemaResponse` to strip any field outside the schema
 * allowlist from admin responses — defense in depth on top of the
 * Prisma `select` in `AdminService`.
 */
export class AdminUserResponseDto extends createSchemaDto(adminUserResponseSchema) {}

/** Admin user list response — `{ data, total }` envelope. */
export class AdminUserListResponseDto extends createSchemaDto(adminUserListResponseSchema) {}
