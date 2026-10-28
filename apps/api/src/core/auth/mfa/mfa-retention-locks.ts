import { Prisma } from '../../../generated/prisma/client.js'

import type { MfaRetentionCandidate } from './mfa-retention-query.js'
import { lockMfaAccounts } from './mfa-transaction.js'

/** The same context → sorted accounts → flow order used by security writers. */
export async function lockRetentionCandidates(
  tx: Prisma.TransactionClient,
  candidates: MfaRetentionCandidate[]
): Promise<void> {
  const distinct = (values: Array<string | null>): string[] =>
    [...new Set(values.filter((value): value is string => value !== null))].sort()
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
  const contexts = distinct(candidates.map((row) => row.browserContextId))
  if (contexts.length)
    await tx.$queryRaw(Prisma.sql`
    SELECT id FROM core.browser_auth_contexts WHERE id IN (${Prisma.join(contexts)}) ORDER BY id FOR UPDATE`)
  await lockMfaAccounts(tx, distinct(candidates.map((row) => row.userId)))
  const flows = distinct(candidates.map((row) => row.flowId))
  if (flows.length)
    await tx.$queryRaw(Prisma.sql`
    SELECT id FROM core.mfa_flows WHERE id IN (${Prisma.join(flows)}) ORDER BY id FOR UPDATE`)
}
