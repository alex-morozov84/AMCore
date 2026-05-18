import { createZodDto } from 'nestjs-zod'

import { paginationQuerySchema } from '@amcore/shared'

/**
 * Reusable pagination DTO (OA-08).
 *
 * Used with `@Query() pagination: PaginationQueryDto` to coerce raw
 * query strings into validated `{ page, limit }` numbers. Invalid
 * input (`?page=abc`, `?limit=-5`, out-of-bounds) returns a clean
 * field-level 400 via the global `ZodValidationPipe`.
 */
export class PaginationQueryDto extends createZodDto(paginationQuerySchema) {}
