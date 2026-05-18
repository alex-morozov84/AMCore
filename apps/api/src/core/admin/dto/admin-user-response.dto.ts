import { createZodDto } from 'nestjs-zod'

import { adminUserListResponseSchema, adminUserResponseSchema } from '@amcore/shared'

/**
 * Admin user response DTO (OA-07).
 *
 * Used with `@ZodSerializerDto` to strip any field outside the schema
 * allowlist from admin responses — defense in depth on top of the
 * Prisma `select` in `AdminService`.
 */
export class AdminUserResponseDto extends createZodDto(adminUserResponseSchema) {}

/** Admin user list response — `{ data, total }` envelope. */
export class AdminUserListResponseDto extends createZodDto(adminUserListResponseSchema) {}
