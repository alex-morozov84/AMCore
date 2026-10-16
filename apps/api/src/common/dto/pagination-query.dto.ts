import { paginationQuerySchema } from '@amcore/shared'

import { createSchemaDto } from '../schemas/schema-dto.js'

/**
 * Reusable pagination DTO (OA-08).
 *
 * Used with `@Query({ schema: PaginationQueryDto.schema }) pagination: PaginationQueryDto` to coerce raw
 * query strings into validated `{ page, limit }` numbers. Invalid
 * input (`?page=abc`, `?limit=-5`, out-of-bounds) returns a clean
 * field-level 400 via the global native schema pipe.
 */
export class PaginationQueryDto extends createSchemaDto(paginationQuerySchema) {}
