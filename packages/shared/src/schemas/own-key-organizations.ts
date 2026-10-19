import { z } from 'zod'

import { serializedJsonBytes } from './organization-members-budget'

const paging = {
  page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
  limit: z.coerce.number().int().min(1).max(20).default(20),
}
export const ownKeyOrganizationsQuerySchema = z
  .strictObject({
    purpose: z.enum(['inventory', 'creation']),
    search: z.string().trim().max(100).optional(),
    selectedId: z.string().cuid().optional(),
    ...paging,
  })
  .refine((q) => Number.isSafeInteger((q.page - 1) * q.limit))
const option = z.strictObject({ id: z.string().cuid(), name: z.string(), slug: z.string() })
const creationOption = option.extend({ canManageTeamAccess: z.boolean() })
const responsePaging = {
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().min(1).max(20),
  hasUnavailable: z.boolean(),
}
export const ownKeyOrganizationsSchema = z
  .discriminatedUnion('purpose', [
    z.strictObject({
      purpose: z.literal('inventory'),
      data: z.array(option).max(20),
      selected: option.nullable(),
      ...responsePaging,
    }),
    z.strictObject({
      purpose: z.literal('creation'),
      data: z.array(creationOption).max(20),
      selected: creationOption.nullable(),
      ...responsePaging,
    }),
  ])
  .refine(
    (r) =>
      new Set(r.data.map((o) => o.id)).size === r.data.length && serializedJsonBytes(r) <= 32768
  )
export type OwnKeyOrganizationsQuery = z.infer<typeof ownKeyOrganizationsQuerySchema>
export type OwnKeyOrganizations = z.infer<typeof ownKeyOrganizationsSchema>
export type OwnKeyOrganizationOption = OwnKeyOrganizations['data'][number]
