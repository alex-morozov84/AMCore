import {
  acceptIntentSchema,
  invitationFlowIdSchema,
  invitationOperationIdSchema,
} from '@amcore/shared'
import { z } from 'zod'

import 'client-only'

const descriptorSchema = z.strictObject({
  operationId: invitationOperationIdSchema,
  ...acceptIntentSchema.shape,
})
export type InvitationAcceptDescriptor = z.infer<typeof descriptorSchema>
type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
function key(flowId: string): string {
  return `amcore:invitation:accept:v1:${invitationFlowIdSchema.parse(flowId)}`
}

/** Stores an intent to recover, never permission to join or authentication credentials. */
export function createInvitationAcceptJournal(
  storage: () => JournalStorage = () => sessionStorage
) {
  return {
    read(flowId: string): InvitationAcceptDescriptor | null {
      try {
        const value = storage().getItem(key(flowId))
        if (value === null) return null
        let decoded: unknown
        try {
          decoded = JSON.parse(value)
        } catch {
          storage().removeItem(key(flowId))
          return null
        }
        const parsed = descriptorSchema.safeParse(decoded)
        if (parsed.success) return parsed.data
        storage().removeItem(key(flowId))
      } catch {
        // Storage can be disabled or contain stale/corrupt data; recovery remains server-authorized.
      }
      return null
    },
    write(flowId: string, descriptor: InvitationAcceptDescriptor): boolean {
      const parsed = descriptorSchema.parse(descriptor)
      try {
        const previous = storage().getItem(key(flowId))
        if (previous !== null && previous !== JSON.stringify(parsed)) return false
        storage().setItem(key(flowId), JSON.stringify(parsed))
        return true
      } catch {
        return false
      }
    },
    clear(flowId: string, operationId: string): void {
      try {
        const raw = storage().getItem(key(flowId))
        if (raw === null) return
        const parsed = descriptorSchema.safeParse(JSON.parse(raw))
        if (parsed.success && parsed.data.operationId === operationId)
          storage().removeItem(key(flowId))
      } catch {
        // A stale callback never removes a newer operation; storage failures do not undo a commit.
      }
    },
  }
}
