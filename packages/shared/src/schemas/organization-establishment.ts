import { z } from 'zod'

import { SUPPORTED_LOCALES } from '../constants'

import { createOrganizationSchema } from './organization'

export const organizationCreationIdSchema = z.uuidv4()
export const organizationCreationPolicySchema = z.strictObject({
  selfServiceCreationEnabled: z.boolean(),
})
export const organizationCreationResultSchema = z.strictObject({
  organizationId: z.string().min(1).max(128),
  completedAt: z.iso.datetime(),
})
export const organizationCreationRequestSchema = z.strictObject({
  ...createOrganizationSchema.shape,
  operationId: organizationCreationIdSchema,
})
export const organizationSetupStateSchema = z.enum([
  'eligible-empty',
  'not-ready',
  'existing-org-without-receipt',
  'completed-intact',
  'completed-changed',
  'unavailable',
])
export const organizationSetupIdsSchema = z.strictObject({
  organizationId: z.string(),
  userId: z.string(),
  memberId: z.string(),
  adminRoleId: z.string(),
  adminGrantId: z.string(),
})
export const organizationSetupStatusSchema = z.strictObject({
  state: organizationSetupStateSchema,
  reason: z.enum(['creation-enabled', 'templates-unavailable', 'schema-unavailable']).optional(),
  ids: organizationSetupIdsSchema.optional(),
  completedAt: z.iso.datetime().optional(),
})
export const organizationPrepareAccountSchema = z.strictObject({
  email: z.email().max(254),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
})
export const organizationPreparedAccountSchema = z.strictObject({
  status: z.enum(['created', 'existing']),
  userId: z.string(),
  emailVerified: z.boolean(),
  nextAction: z.enum(['sign-in', 'verify-email']),
})
export const organizationSetupAccountSchema = z.strictObject({
  userId: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  state: organizationSetupStateSchema,
})
export const organizationBootstrapSchema = z.strictObject({
  name: createOrganizationSchema.shape.name,
  slug: createOrganizationSchema.shape.slug.unwrap(),
  adminUserId: z.string().min(1).max(128),
})
export const organizationBootstrapResultSchema = z.strictObject({
  status: z.enum(['created', 'already_completed']),
  ids: organizationSetupIdsSchema,
  completedAt: z.iso.datetime(),
})
