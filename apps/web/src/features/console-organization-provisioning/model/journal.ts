import {
  contextSessionBindingSchema,
  DEFAULT_LOCALE,
  invitationOperationIdSchema,
  provisioningCancelSchema,
  provisioningCreateSchema,
  provisioningReissueSchema,
  provisioningReplaceSchema,
  SUPPORTED_LOCALES,
} from '@amcore/shared'
import { z } from 'zod'

import 'client-only'

export const provisioningDraftSchema = z.strictObject({
  name: z.string().max(100),
  slug: z.string().max(50),
  firstAdminEmail: z.string().max(254),
  inviteLocale: z.enum(SUPPORTED_LOCALES),
})
const pending = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), input: provisioningCreateSchema }),
  z.strictObject({ kind: z.literal('reissue'), input: provisioningReissueSchema }),
  z.strictObject({ kind: z.literal('replace-recipient'), input: provisioningReplaceSchema }),
  z.strictObject({ kind: z.literal('cancel'), input: provisioningCancelSchema }),
])
const schema = z.strictObject({
  version: z.literal(1),
  actorId: z.string(),
  binding: contextSessionBindingSchema,
  at: z.number(),
  open: z.boolean(),
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  draft: provisioningDraftSchema,
  organizationId: z.string().optional(),
  pending: pending.optional(),
  expiredOperationId: invitationOperationIdSchema.optional(),
})
export type ProvisioningDraft = z.infer<typeof provisioningDraftSchema>
export type ProvisioningJournal = z.infer<typeof schema>
export type PendingProvisioning = z.infer<typeof pending>
export const emptyProvisioningDraft: ProvisioningDraft = {
  name: '',
  slug: '',
  firstAdminEmail: '',
  inviteLocale: DEFAULT_LOCALE,
}
const key = (scope: string) => `amcore:organization-provisioning:v1:${scope}`
export function readProvisioningJournal(
  binding: string,
  actorId: string,
  scope: string
): ProvisioningJournal | undefined {
  try {
    const raw = localStorage.getItem(key(scope))
    if (!raw) return
    const parsed = raw.length <= 8192 ? schema.safeParse(JSON.parse(raw)) : undefined
    if (!parsed?.success || parsed.data.actorId !== actorId) {
      localStorage.removeItem(key(scope))
      return
    }
    const row = { ...parsed.data, binding }
    if (Date.now() - row.at <= 86_400_000) return row
    // Expired drafts lose PII; an unresolved create retains only its recovery identity.
    return {
      ...row,
      draft: emptyProvisioningDraft,
      pending: undefined,
      expiredOperationId:
        row.pending?.kind === 'create' ? row.pending.input.operationId : row.expiredOperationId,
    }
  } catch {
    return
  }
}
export function writeProvisioningJournal(row: ProvisioningJournal, scope: string): boolean {
  try {
    localStorage.setItem(key(scope), JSON.stringify(schema.parse(row)))
    return true
  } catch {
    return false
  }
}
