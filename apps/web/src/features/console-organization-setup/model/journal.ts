import {
  contextSessionBindingSchema,
  organizationBootstrapSchema,
  organizationPrepareAccountSchema,
  organizationSetupAccountSchema,
} from '@amcore/shared'
import { z } from 'zod'

import 'client-only'

export const setupPendingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('prepare'), input: organizationPrepareAccountSchema }),
  z.strictObject({ kind: z.literal('bootstrap'), input: organizationBootstrapSchema }),
])
const recordSchema = z.strictObject({
  version: z.literal(1),
  binding: contextSessionBindingSchema,
  actorId: z.string().min(1).max(128),
  step: z.enum(['administrator', 'organization', 'review']).optional(),
  draft: z.strictObject({
    email: z.string().max(254),
    name: z.string().max(100),
    slug: z.string().max(50),
  }),
  previousRecipientId: z.string().min(1).max(128).optional(),
  selected: organizationSetupAccountSchema.optional(),
  pending: setupPendingSchema.optional(),
})
export type SetupJournalRecord = z.infer<typeof recordSchema>
export type SetupStep = NonNullable<SetupJournalRecord['step']>
export type SetupPending = z.infer<typeof setupPendingSchema>
const key = 'amcore:initial-organization-setup:v1'

export function readSetupJournal(binding: string, actorId: string): SetupJournalRecord | undefined {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return
    const parsed = raw.length <= 8192 ? recordSchema.safeParse(JSON.parse(raw)) : undefined
    if (parsed?.success && parsed.data.binding === binding && parsed.data.actorId === actorId)
      return parsed.data
    sessionStorage.removeItem(key)
  } catch {
    /* Storage denial never supplies setup authority. */
  }
}
export function writeSetupJournal(record: SetupJournalRecord): boolean {
  try {
    sessionStorage.setItem(key, JSON.stringify(recordSchema.parse(record)))
    return true
  } catch {
    return false
  }
}
