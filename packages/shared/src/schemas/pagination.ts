import { z, type ZodTypeAny } from 'zod'

import { PAGINATION } from '../constants'

/**
 * Reusable pagination query schema (OA-08).
 *
 * `z.coerce.number()` accepts the string values NestJS passes from the
 * query string (`?page=2`) and converts to number before validation.
 * Defaults match `PAGINATION.DEFAULT_*`; bounds enforce `page >= 1` and
 * `1 <= limit <= PAGINATION.MAX_LIMIT`. Invalid input returns a clean
 * field-level 400 via the global `ZodValidationPipe`.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>

/**
 * Paginated list envelope (OA-08).
 *
 * Used as the response shape for all paginated list endpoints. Includes
 * `page` and `limit` alongside `data` and `total` so clients do not need
 * to track the query they sent.
 */
export const paginatedResponseSchema = <T extends ZodTypeAny>(
  item: T
): z.ZodObject<{
  data: z.ZodArray<T>
  total: z.ZodNumber
  page: z.ZodNumber
  limit: z.ZodNumber
}> =>
  z.object({
    data: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
  })

export type PaginatedResponse<T> = {
  data: T[]
  total: number
  page: number
  limit: number
}
