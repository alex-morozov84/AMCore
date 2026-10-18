import {
  administratorAssignmentSchema,
  administratorInvitationCancelSchema,
  administratorInvitationCreateSchema,
  administratorInvitationReissueSchema,
  administratorInvitationReplaceSchema,
  invitationOperationIdSchema,
} from '@amcore/shared'
import { z } from 'zod'

import 'client-only'

export const administratorPendingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), input: administratorInvitationCreateSchema }),
  z.strictObject({ kind: z.literal('assign'), input: administratorAssignmentSchema }),
  z.strictObject({
    kind: z.literal('cancel'),
    id: invitationOperationIdSchema,
    input: administratorInvitationCancelSchema,
  }),
  z.strictObject({
    kind: z.literal('replace-recipient'),
    id: invitationOperationIdSchema,
    input: administratorInvitationReplaceSchema,
  }),
  z.strictObject({
    kind: z.literal('reissue'),
    id: invitationOperationIdSchema,
    input: administratorInvitationReissueSchema,
  }),
])
export type AdministratorPending = z.infer<typeof administratorPendingSchema>
const journal = z.strictObject({
  actorId: z.string(),
  at: z.number(),
  operationId: invitationOperationIdSchema,
  pending: administratorPendingSchema.optional(),
})
export type AdministratorJournal = z.infer<typeof journal>
const key = (orgId: string) => `amcore:organization-administration:v1:${orgId}`
export function readAdministratorJournal(
  orgId: string,
  actorId: string
): AdministratorJournal | undefined {
  try {
    const raw = localStorage.getItem(key(orgId))
    const parsed = raw && raw.length <= 16384 ? journal.safeParse(JSON.parse(raw)) : undefined
    if (!parsed?.success || parsed.data.actorId !== actorId) return
    return Date.now() - parsed.data.at <= 86400000
      ? parsed.data
      : { ...parsed.data, pending: undefined }
  } catch {
    return
  }
}
export function writeAdministratorJournal(orgId: string, row?: AdministratorJournal): boolean {
  try {
    if (row) localStorage.setItem(key(orgId), JSON.stringify(journal.parse(row)))
    else localStorage.removeItem(key(orgId))
    return true
  } catch {
    return false
  }
}
