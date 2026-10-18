import type { z } from 'zod'

import type {
  memberKeyCommandSchema,
  memberKeyListSchema,
  memberKeyQuerySchema,
  memberKeyResultSchema,
} from '../schemas/member-api-keys'

export type MemberKeyCommand = z.infer<typeof memberKeyCommandSchema>
export type MemberKeyQuery = z.infer<typeof memberKeyQuerySchema>
export type MemberKeyList = z.infer<typeof memberKeyListSchema>
export type MemberKeyResult = z.infer<typeof memberKeyResultSchema>
