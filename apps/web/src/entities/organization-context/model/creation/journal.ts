import { contextSessionBindingSchema, organizationCreationRequestSchema } from '@amcore/shared'
import { z } from 'zod'

import 'client-only'

const recordSchema = z.strictObject({
  version: z.literal(1),
  binding: contextSessionBindingSchema,
  actorId: z.string().min(1).max(128),
  input: organizationCreationRequestSchema,
})
export type OrganizationCreationAttempt = z.infer<typeof recordSchema>
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const key = 'amcore:organization-creation:v1'

export function organizationCreationJournal(storage: () => StorageAccess = () => sessionStorage) {
  return {
    read(
      binding: string,
      actorId: string
    ): { attempt: OrganizationCreationAttempt | null; available: boolean } {
      try {
        const raw = storage().getItem(key)
        if (raw === null) return { attempt: null, available: true }
        const parsed = raw.length <= 4096 ? recordSchema.safeParse(JSON.parse(raw)) : undefined
        if (parsed?.success && parsed.data.binding === binding && parsed.data.actorId === actorId)
          return { attempt: parsed.data, available: true }
        storage().removeItem(key)
        return { attempt: null, available: true }
      } catch {
        return { attempt: null, available: false }
      }
    },
    write(attempt: OrganizationCreationAttempt): boolean {
      try {
        const raw = storage().getItem(key)
        const value = JSON.stringify(recordSchema.parse(attempt))
        if (raw !== null && raw !== value) return false
        storage().setItem(key, value)
        return true
      } catch {
        return false
      }
    },
    clear(attempt: OrganizationCreationAttempt): void {
      try {
        const parsed = recordSchema.safeParse(JSON.parse(storage().getItem(key) ?? 'null'))
        if (
          parsed.success &&
          parsed.data.binding === attempt.binding &&
          parsed.data.input.operationId === attempt.input.operationId
        )
          storage().removeItem(key)
      } catch {
        /* Do not erase a newer or inaccessible attempt. */
      }
    },
  }
}
