import {
  coerceSupportedLocale,
  contextSessionBindingSchema,
  DEFAULT_LOCALE,
  invitationOperationIdSchema,
  LOCALE_CATALOGUES,
  provisioningCancelSchema,
  provisioningCreateSchema,
  provisioningReissueSchema,
  provisioningReplaceSchema,
  SERVED_LOCALES,
} from '@amcore/shared'
import { z } from 'zod'

import 'client-only'

export const provisioningDraftSchema = z.strictObject({
  name: z.string().max(100),
  slug: z.string().max(50),
  firstAdminEmail: z.string().max(254),
  inviteLocale: z.enum(SERVED_LOCALES),
})
// A frozen command is exactly what was sent (or may have been sent) and its operation ID is bound
// to that content. It may name a locale the build no longer serves, so it is read against the
// shipped catalogues and is never rewritten; `isReplayable` says whether this build may send it.
const frozenLocale = z.enum(LOCALE_CATALOGUES)
const pending = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('create'),
    input: provisioningCreateSchema.extend({ inviteLocale: frozenLocale }),
  }),
  z.strictObject({ kind: z.literal('reissue'), input: provisioningReissueSchema }),
  z.strictObject({
    kind: z.literal('replace-recipient'),
    input: provisioningReplaceSchema.extend({ inviteLocale: frozenLocale }),
  }),
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
    const parsed =
      raw.length <= 8192 ? schema.safeParse(withServedLocales(JSON.parse(raw))) : undefined
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
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A saved draft can outlive a deployment that changed the served languages. Map its invitation
 * locale to the default instead of discarding the draft. Only the editable draft is changed: a
 * frozen command keeps its content and operation ID (see `isReplayable`). Every other field is
 * left for the strict schema to judge.
 */
function withServedLocales(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.draft)) return value
  const draft =
    typeof value.draft.inviteLocale === 'string'
      ? { ...value.draft, inviteLocale: coerceSupportedLocale(value.draft.inviteLocale) }
      : value.draft
  return { ...value, draft }
}

/**
 * Whether this build may send the frozen command again. The API accepts request input in a served
 * locale only, so a command written under other settings would be refused and its operation ID
 * could not be replayed; the caller then looks the result up instead of sending it.
 */
export function isReplayable(command: PendingProvisioning): boolean {
  return !('inviteLocale' in command.input) || SERVED_LOCALES.includes(command.input.inviteLocale)
}
export function writeProvisioningJournal(row: ProvisioningJournal, scope: string): boolean {
  try {
    localStorage.setItem(key(scope), JSON.stringify(schema.parse(row)))
    return true
  } catch {
    return false
  }
}
