import { z } from 'zod'

import { OWN_KEY_MAX_SCOPES } from '../constants/own-api-keys'

import {
  apiKeyListItemSchema,
  apiKeyQuerySchema,
  createApiKeyResponseSchema,
  createApiKeySchema,
} from './api-keys'
import { contextSessionBindingSchema } from './product-access'

export const ownKeyQuerySchema = apiKeyQuerySchema
  .strict()
  .refine(
    (q) =>
      !(q.organizationId && q.organizationAvailability) &&
      Number.isSafeInteger((q.page - 1) * q.limit)
  )
export const ownKeyCreateSchema = createApiKeySchema
  .strict()
  .extend({ scopes: createApiKeySchema.shape.scopes.max(OWN_KEY_MAX_SCOPES) })
export const ownKeyListSchema = z.strictObject({
  data: z.array(apiKeyListItemSchema.strict()),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
})
export const ownKeyCreatedSchema = createApiKeyResponseSchema
  .strict()
  .extend({ key: z.string().min(1) })
export const ownKeyRevokedSchema = z.strictObject({ revoked: z.literal(true) })
export const ownKeySessionSchema = z.strictObject({ verified: z.literal(true) })
export const ownKeyAdmissionSchema = z.strictObject({
  binding: contextSessionBindingSchema,
  actorId: z.string().min(1),
})
export type OwnApiKeyAdmission = z.infer<typeof ownKeyAdmissionSchema>
