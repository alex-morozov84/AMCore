import { z } from 'zod'

import { SUPPORTED_LOCALES } from '../constants'
import { ORGANIZATION_CONTEXT_ID_PATTERN } from '../constants/organization-context'

export const frontendDestinationSchema = z.enum(['site', 'admin'])
export type FrontendDestination = z.infer<typeof frontendDestinationSchema>

export const productAdminConfigSchema = z.strictObject({
  version: z.literal(1),
  mode: z.enum(['path', 'host']),
  alias: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
})
export type ProductAdminConfig = z.infer<typeof productAdminConfigSchema>

export const WEB_FRONTEND_HEADERS = Object.freeze({
  frontend: 'x-amcore-web-frontend',
  placement: 'x-amcore-web-placement',
  key: 'x-amcore-web-context-key',
})

const contextId = z.string().regex(new RegExp(ORGANIZATION_CONTEXT_ID_PATTERN))
const returnQuerySchema = z.strictObject({
  page: z.number().int().min(1).max(100_000).optional(),
  view: z.literal('list').optional(),
  search: z.string().max(254).optional(),
  status: z.enum(['all', 'pending', 'active', 'expired', 'revoked']).optional(),
  role: contextId.optional(),
  organizationId: z.string().cuid().optional(),
  organizationAvailability: z.literal('unavailable').optional(),
})

/** Navigation only. Every destination still requires server admission. */
export const productAdminReturnSchema = z
  .strictObject({
    page: z.enum([
      'organizations',
      'organization',
      'members',
      'invites',
      'roles',
      'role',
      'own-keys',
      'sessions',
    ]),
    orgId: contextId.optional(),
    roleId: contextId.optional(),
    locale: z.enum(SUPPORTED_LOCALES).optional(),
    query: returnQuerySchema.optional(),
  })
  .refine((value) => {
    const needsOrg = ['organization', 'members', 'invites', 'roles', 'role'].includes(value.page)
    return needsOrg === Boolean(value.orgId) && (value.page === 'role') === Boolean(value.roleId)
  })

export type ProductAdminReturn = z.infer<typeof productAdminReturnSchema>
