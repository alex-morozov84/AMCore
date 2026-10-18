import { z } from 'zod'

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../constants'

import { invitationOperationIdSchema } from './invitation-operations'
import { createOrganizationSchema } from './organization'

const id = z.string().min(1).max(128)
export const provisioningCreateSchema = z.strictObject({
  operationId: invitationOperationIdSchema,
  name: createOrganizationSchema.shape.name.trim(),
  slug: createOrganizationSchema.shape.slug,
  firstAdminEmail: z.email().max(254),
  inviteLocale: z.enum(SUPPORTED_LOCALES).default(DEFAULT_LOCALE),
})
export const provisioningCancelSchema = z.strictObject({
  operationId: invitationOperationIdSchema,
  expectedRevision: z.number().int().positive(),
})
export const provisioningReissueSchema = provisioningCancelSchema.extend({
  expectedInviteId: id,
  expectedGeneration: z.number().int().positive(),
})
export const provisioningReplaceSchema = provisioningCancelSchema.extend({
  firstAdminEmail: z.email().max(254),
  inviteLocale: z.enum(SUPPORTED_LOCALES).default(DEFAULT_LOCALE),
})
export const provisioningReceiptSchema = z.strictObject({
  operationId: invitationOperationIdSchema,
  organizationId: id,
  createdAt: z.iso.datetime(),
})
export const provisioningCommandReceiptSchema = z.strictObject({
  operationId: invitationOperationIdSchema,
  organizationId: id,
  revision: z.number().int().positive(),
})
export const provisioningPolicySchema = z.strictObject({
  role: z.literal('ADMIN'),
  mailMode: z.enum(['mock', 'provider']),
  createAllowed: z.boolean(),
})
export const provisioningLookupSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('committed'), receipt: provisioningReceiptSchema }),
  z.strictObject({
    state: z.literal('unrecorded'),
    sameIdAdmissible: z.boolean(),
  }),
  z.strictObject({ state: z.literal('expired_unrecorded') }),
])
export const provisioningProgressSchema = z.strictObject({
  organizationId: id,
  creationOperationId: invitationOperationIdSchema,
  available: z.boolean(),
  revision: z.number().int().positive(),
  state: z.enum(['awaiting', 'completed', 'cancelled']),
  invite: z
    .strictObject({
      id,
      generation: z.number().int().positive(),
      email: z.string(),
      expiresAt: z.iso.datetime(),
      status: z.enum(['pending', 'expired', 'unavailable']),
    })
    .nullable(),
  completedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  access: z.enum(['original_grant_present', 'removed', 'unconfirmed', 'not_established']),
  mailOutcome: z.enum(['unconfirmed', 'provider_acknowledged', 'mock']).nullable(),
  policy: provisioningPolicySchema,
})
