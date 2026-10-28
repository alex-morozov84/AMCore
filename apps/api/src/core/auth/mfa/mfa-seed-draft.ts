import { z } from 'zod'

import { ServiceUnavailableException } from '../../../common/exceptions/index.js'
import type { Prisma } from '../../../generated/prisma/client.js'

import { flowData } from './mfa-flow-state.js'

export const seedDraftSchema = z
  .object({
    id: z.string().uuid(),
    factorId: z.string().uuid(),
    keyId: z.string().min(1),
    encryptedSeed: z.string().min(1),
    expiresAt: z.iso.datetime(),
  })
  .strict()
export type SeedDraft = z.infer<typeof seedDraftSchema>

export function readSeedDraft(data: Prisma.JsonValue): SeedDraft | null {
  const draft = flowData(data).seedDraft
  if (draft === undefined) return null
  const parsed = seedDraftSchema.safeParse(draft)
  if (!parsed.success) throw new ServiceUnavailableException('MFA seed draft unavailable')
  return parsed.data
}

/** Caller holds the account lock. Conservative refusal never evicts another device's draft. */
export async function hasOtherSeedDraft(
  tx: Prisma.TransactionClient,
  userId: string,
  securityVersion: number,
  flowId: string,
  now: Date
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM core.mfa_flows
    WHERE "userId" = ${userId} AND "securityVersion" = ${securityVersion}
      AND id <> ${flowId} AND state = 'open' AND "expiresAt" > ${now}
      AND data ? 'seedDraft' LIMIT 1`
  return rows.length > 0
}
