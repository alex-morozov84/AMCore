import { contextSessionBindingSchema, createInviteSchema, invitationOperationIdSchema,
  invitationOperationTimestamp, reissueInviteSchema, revokeInviteQuerySchema } from '@amcore/shared'
import { z } from 'zod'

import 'client-only'

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
export const invitationManagerCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), input: createInviteSchema }),
  z.strictObject({ kind: z.literal('reissue'), inviteId: id, input: reissueInviteSchema }),
  z.strictObject({ kind: z.literal('revoke'), inviteId: id, input: revokeInviteQuerySchema }),
])
export type InvitationManagerCommand = z.infer<typeof invitationManagerCommandSchema>
const recordSchema = z.strictObject({ binding: contextSessionBindingSchema, organizationId: id,
  operationId: invitationOperationIdSchema, command: invitationManagerCommandSchema })
export type InvitationManagerJournalRecord = z.infer<typeof recordSchema>
export const managerOperationExpired = (record: InvitationManagerJournalRecord, now = Date.now()) =>
  now - invitationOperationTimestamp(record.operationId) >= 86400000
const key = (org: string) => `amcore:invitation:manager:v1:${id.parse(org)}`
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** One unresolved operation per organization/tab; no credential or grant is stored. */
export function createInvitationManagerJournal(storage: () => StorageAccess = () => sessionStorage) {
  return {
    read(binding: string, organizationId: string): InvitationManagerJournalRecord | null {
      try {
        const raw = storage().getItem(key(organizationId))
        if (raw === null) return null
        const parsed = recordSchema.safeParse(JSON.parse(raw))
        if (parsed.success && parsed.data.binding === binding && parsed.data.organizationId === organizationId)
          return parsed.data
        storage().removeItem(key(organizationId))
      } catch { /* Storage denial leaves explicit in-memory recovery available. */ }
      return null
    },
    write(record: InvitationManagerJournalRecord): boolean {
      const parsed = recordSchema.parse(record)
      try {
        const raw = storage().getItem(key(parsed.organizationId))
        if (raw !== null && raw !== JSON.stringify(parsed)) return false
        storage().setItem(key(parsed.organizationId), JSON.stringify(parsed))
        return true
      } catch { return false }
    },
    clear(record: InvitationManagerJournalRecord) {
      try {
        const raw = storage().getItem(key(record.organizationId))
        if (!raw) return
        const parsed = recordSchema.safeParse(JSON.parse(raw))
        if (parsed.success && parsed.data.operationId === record.operationId && parsed.data.binding === record.binding)
          storage().removeItem(key(record.organizationId))
      } catch { /* A stale callback cannot remove a newer operation. */ }
    },
  }
}
