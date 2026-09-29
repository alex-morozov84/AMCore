import { z } from 'zod'

import { adminDetailIdSchema } from './admin-detail'
import { paginatedResponseSchema, paginationQuerySchema } from './pagination'

export const apiKeyStatusSchema = z.enum(['unexpired', 'expired', 'revoked'])
export const apiKeyStatusFilterSchema = z.enum(['all', 'unexpired', 'expired', 'revoked'])
export const apiKeyRevocationReasonSchema = z.enum(['owner_revoked', 'platform_revoked'])
export const ADMIN_API_KEY_SORT_FIELDS = [
  'name',
  'createdAt',
  'expiresAt',
  'lastUsedAt',
  'revokedAt',
] as const

export const adminApiKeyQuerySchema = paginationQuerySchema.extend({
  status: apiKeyStatusFilterSchema.default('all'),
  userId: adminDetailIdSchema.optional(),
  organizationId: adminDetailIdSchema.optional(),
  id: z.cuid().optional(),
  search: z
    .string()
    .max(100)
    .optional()
    .transform((value) => value?.trim() || undefined),
  sortBy: z.enum(ADMIN_API_KEY_SORT_FIELDS).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional(),
})

export const adminApiKeySchema = z.object({
  id: z.cuid(),
  name: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  revocationReason: apiKeyRevocationReasonSchema.nullable(),
  status: apiKeyStatusSchema,
  owner: z.object({ id: adminDetailIdSchema, name: z.string().nullable(), email: z.email() }),
  organization: z.object({ id: adminDetailIdSchema, name: z.string(), slug: z.string() }),
})

export const adminApiKeyListResponseSchema = paginatedResponseSchema(adminApiKeySchema)
export const adminApiKeyRevokeSchema = z.strictObject({
  ids: z
    .array(z.cuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
})
export const adminApiKeyRevokeResponseSchema = z
  .object({
    requestedCount: z.number().int().min(1).max(100),
    affectedCount: z.number().int().min(0).max(100),
  })
  .refine((result) => result.affectedCount <= result.requestedCount)

export type AdminApiKeyQuery = z.infer<typeof adminApiKeyQuerySchema>
export type AdminApiKey = z.infer<typeof adminApiKeySchema>
export type AdminApiKeyListResponse = z.infer<typeof adminApiKeyListResponseSchema>
export type AdminApiKeyRevokeInput = z.infer<typeof adminApiKeyRevokeSchema>
export type AdminApiKeyRevokeResponse = z.infer<typeof adminApiKeyRevokeResponseSchema>
