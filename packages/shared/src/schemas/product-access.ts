import { z } from 'zod'

import { organizationContextResponseSchema, organizationListResponseSchema } from './organization'

export const contextSessionBindingSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const productAccessBootstrapSchema = z.strictObject({
  binding: contextSessionBindingSchema,
  actor: z.strictObject({ id: z.string(), email: z.email() }),
})
export const productOrganizationListSchema = z.strictObject({
  binding: contextSessionBindingSchema,
  data: organizationListResponseSchema,
})
export const productOrganizationContextSchema = z.strictObject({
  binding: contextSessionBindingSchema,
  data: organizationContextResponseSchema,
})

export type ProductAccessBootstrap = z.infer<typeof productAccessBootstrapSchema>
export type ProductOrganizationList = z.infer<typeof productOrganizationListSchema>
export type ProductOrganizationContext = z.infer<typeof productOrganizationContextSchema>
