import { z } from 'zod'

import { apiKeyStatusFilterSchema } from './admin-api-keys'
import { apiKeyListItemSchema } from './api-keys'
import { memberIdSchema } from './organization-members'

export const MEMBER_KEY_ALL_LIMIT = 1000
export const MEMBER_KEY_REQUEST_BYTES = 4096
export const MEMBER_KEY_QUERY_BYTES = 2048
export const MEMBER_KEY_API_BYTES = 245760
export const MEMBER_KEY_ENVELOPE_BYTES = 262144
export const memberKeyCommandSchema = z.strictObject({ expectedMemberId: memberIdSchema })
export const memberKeyQuerySchema = memberKeyCommandSchema.extend({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: apiKeyStatusFilterSchema.default('all'),
})
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const memberKeyListSchema = z.strictObject({
  organization: z.strictObject({ id: memberIdSchema, name: z.string() }),
  member: z.strictObject({
    memberId: memberIdSchema,
    userId: memberIdSchema,
    name: z.string().nullable(),
    email: z.string(),
  }),
  data: z.array(apiKeyListItemSchema.omit({ organizationId: true })).max(100),
  total: count,
  page: z.number().int().min(1).max(10000),
  limit: z.number().int().min(1).max(100),
  revocableCount: count,
  asOf: z.iso.datetime(),
  revokeAllLimit: z.literal(MEMBER_KEY_ALL_LIMIT),
})
export const memberKeyResultSchema = z
  .strictObject({
    organizationId: memberIdSchema,
    userId: memberIdSchema,
    memberId: memberIdSchema,
    keyId: memberIdSchema.optional(),
    requestedCount: count.max(MEMBER_KEY_ALL_LIMIT),
    affectedCount: count.max(MEMBER_KEY_ALL_LIMIT),
  })
  .refine((r) => r.affectedCount <= r.requestedCount)
