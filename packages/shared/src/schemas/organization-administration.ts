import { z } from 'zod'

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../constants'

import { invitationOperationIdSchema } from './invitation-operations'
import { utf8Bytes } from './organization-members-budget'
import { provisioningPolicySchema, provisioningProgressSchema } from './organization-provisioning'

const id = z.string().min(1).max(128)
export const administratorReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .superRefine((value, ctx) => {
    if (utf8Bytes(value) > 2000 || /[\p{Cc}]/u.test(value)) ctx.addIssue({ code: 'custom' })
  })
const operation = z.strictObject({
  operationId: invitationOperationIdSchema,
  reason: administratorReasonSchema,
})
export const administratorInvitationCreateSchema = operation.extend({
  email: z.email().max(254),
  inviteLocale: z.enum(SUPPORTED_LOCALES).default(DEFAULT_LOCALE),
  supersedesInvite: z.strictObject({ id, generation: z.number().int().positive() }).optional(),
})
export const administratorInvitationCancelSchema = operation.extend({
  expectedRevision: z.number().int().positive(),
})
export const administratorInvitationReissueSchema = administratorInvitationCancelSchema.extend({
  expectedInviteId: id,
  expectedGeneration: z.number().int().positive(),
})
export const administratorInvitationReplaceSchema = administratorInvitationCancelSchema.extend({
  email: z.email().max(254),
  inviteLocale: z.enum(SUPPORTED_LOCALES).default(DEFAULT_LOCALE),
})
export const administratorAssignmentSchema = operation.extend({
  userId: id,
  expectedMemberId: id,
  expectedAclVersion: z.number().int().nonnegative(),
})
export const administratorCommandReceiptSchema = z.strictObject({
  operationId: invitationOperationIdSchema,
  organizationId: id,
  administratorInvitationId: invitationOperationIdSchema,
  revision: z.number().int().positive(),
})
export const administratorAssignmentReceiptSchema = z.strictObject({
  operationId: invitationOperationIdSchema,
  organizationId: id,
  userId: id,
  memberId: id,
  adminGrantId: id,
  aclVersion: z.number().int().nonnegative(),
  changed: z.boolean(),
})
export const administratorOperationSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('unknown'), expiredUnrecorded: z.boolean() }),
  z.strictObject({
    state: z.literal('committed'),
    receipt: z.union([administratorCommandReceiptSchema, administratorAssignmentReceiptSchema]),
  }),
])
export const administratorInvitationProgressSchema = z.strictObject({
  id: invitationOperationIdSchema,
  organizationId: id,
  revision: z.number().int().positive(),
  state: z.enum(['awaiting', 'completed', 'cancelled']),
  invite: provisioningProgressSchema.shape.invite,
  completedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  mailOutcome: provisioningProgressSchema.shape.mailOutcome,
})
const page = z.coerce.number().int().min(1).max(10000).default(1)
const limit = z.coerce.number().int().min(1).max(50).default(20)
export const administratorAttentionQuerySchema = z.strictObject({
  page,
  limit,
  search: z.string().trim().max(100).optional(),
})
export const administratorSummaryQuerySchema = z.strictObject({
  adminPage: page,
  invitationPage: page,
  limit,
})
const attentionReason = z.enum([
  'no_administrator',
  'pending',
  'expired',
  'recipient_required',
  'mail_unconfirmed',
  'invitation_unavailable',
])
export const administratorAttentionSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  organizationTotal: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
  data: z.array(
    z.strictObject({
      organizationId: id,
      name: z.string(),
      slug: z.string(),
      adminCount: z.number().int().nonnegative(),
      pendingAdminInvitationCount: z.number().int().nonnegative(),
      reasons: z.array(attentionReason),
    })
  ),
})
export const administratorSummarySchema = z.strictObject({
  organizationId: id,
  name: z.string(),
  aclVersion: z.number().int().nonnegative(),
  checkedAt: z.iso.datetime(),
  policy: provisioningPolicySchema,
  administrators: z.strictObject({
    total: z.number().int().nonnegative(),
    data: z.array(
      z.strictObject({
        userId: id,
        memberId: id,
        name: z.string().nullable(),
        email: z.string(),
      })
    ),
  }),
  invitations: z.strictObject({
    total: z.number().int().nonnegative(),
    data: z.array(administratorInvitationProgressSchema),
  }),
  initial: provisioningProgressSchema.nullable(),
})
