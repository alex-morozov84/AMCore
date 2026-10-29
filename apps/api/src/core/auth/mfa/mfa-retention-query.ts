import { Prisma } from '../../../generated/prisma/client.js'

export const MFA_RETENTION_BUCKETS = [
  'drafts',
  'receipts',
  'settingsStarts',
  'logoutReceipts',
  'flows',
  'families',
  'contexts',
] as const
export type MfaRetentionBucket = (typeof MFA_RETENTION_BUCKETS)[number]
export interface MfaRetentionCandidate {
  id: string
  userId: string | null
  browserContextId: string | null
  flowId: string | null
}

/** Closed SQL fragments only. Conditions repeat after ordered locks; hints grant no delete authority. */
export function retentionSource(
  bucket: MfaRetentionBucket,
  now: Date
): {
  source: Prisma.Sql
  columns: Prisma.Sql
  due: Prisma.Sql
} {
  const cutoff = new Date(now.getTime() - 86400_000)
  if (bucket === 'settingsStarts')
    return {
      source: Prisma.sql`core.mfa_settings_start_receipts AS r`,
      columns: Prisma.sql`r."operationId" AS id, r."userId", r."browserContextId", NULL::text AS "flowId"`,
      due: Prisma.sql`r."expiresAt" <= ${cutoff} AND r."startNotAfter" <= ${now}`,
    }
  if (bucket === 'logoutReceipts')
    return {
      source: Prisma.sql`core.browser_logout_receipts AS r`,
      columns: Prisma.sql`r."operationId" AS id, r."userId", r."contextId" AS "browserContextId", NULL::text AS "flowId"`,
      due: Prisma.sql`r."expiresAt" <= ${cutoff}`,
    }
  if (bucket === 'drafts' || bucket === 'flows')
    return {
      source: Prisma.sql`core.mfa_flows AS f`,
      columns: Prisma.sql`f.id, f."userId", f."browserContextId", f.id AS "flowId"`,
      due:
        bucket === 'drafts'
          ? Prisma.sql`f."expiresAt" <= ${now} AND f.data <> '{}'::jsonb`
          : Prisma.sql`f."expiresAt" <= ${cutoff} AND NOT EXISTS
          (SELECT 1 FROM core.mfa_operations o WHERE o."flowId" = f.id)`,
    }
  if (bucket === 'receipts')
    return {
      source: Prisma.sql`core.mfa_operations AS o JOIN core.mfa_flows f ON f.id = o."flowId"`,
      columns: Prisma.sql`o.id, f."userId", f."browserContextId", f.id AS "flowId"`,
      due: Prisma.sql`o."createdAt" <= ${cutoff} AND f."expiresAt" <= ${now}`,
    }
  if (bucket === 'families')
    return {
      source: Prisma.sql`core.auth_session_families AS f`,
      columns: Prisma.sql`f.id, f."userId", f."browserContextId", NULL::text AS "flowId"`,
      due: Prisma.sql`f."retainUntil" <= ${now} AND f."expiresAt" <= ${now}
      AND NOT EXISTS (SELECT 1 FROM core.sessions s WHERE s."familyId" = f.id AND s."expiresAt" > ${now})`,
    }
  return {
    source: Prisma.sql`core.browser_auth_contexts AS c`,
    columns: Prisma.sql`c.id, NULL::text AS "userId", c.id AS "browserContextId", NULL::text AS "flowId"`,
    due: Prisma.sql`c."expiresAt" <= ${now}
      AND NOT EXISTS (SELECT 1 FROM core.auth_session_families f WHERE f."browserContextId" = c.id)
      AND NOT EXISTS (SELECT 1 FROM core.mfa_flows f WHERE f."browserContextId" = c.id)`,
  }
}

export async function retentionCandidates(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  bucket: MfaRetentionBucket,
  now: Date,
  limit = 100
): Promise<MfaRetentionCandidate[]> {
  const { source, columns, due } = retentionSource(bucket, now)
  return tx.$queryRaw<MfaRetentionCandidate[]>(Prisma.sql`
    SELECT ${columns} FROM ${source} WHERE ${due} ORDER BY 1 LIMIT ${limit}`)
}

/** No cascading delete: a flow becomes eligible only after all retained receipts have gone. */
export async function pruneRetentionCandidates(
  tx: Prisma.TransactionClient,
  bucket: MfaRetentionBucket,
  candidates: MfaRetentionCandidate[],
  now: Date
): Promise<number> {
  if (!candidates.length) return 0
  const { due } = retentionSource(bucket, now)
  const ids = Prisma.join(candidates.map((row) => row.id))
  if (bucket === 'settingsStarts')
    return tx.$executeRaw(Prisma.sql`
    DELETE FROM core.mfa_settings_start_receipts AS r WHERE r."operationId" IN (${ids}) AND ${due}`)
  if (bucket === 'logoutReceipts')
    return tx.$executeRaw(Prisma.sql`
    DELETE FROM core.browser_logout_receipts AS r WHERE r."operationId" IN (${ids}) AND ${due}`)
  if (bucket === 'drafts')
    return tx.$executeRaw(Prisma.sql`
    UPDATE core.mfa_flows AS f SET data = '{}'::jsonb WHERE f.id IN (${ids}) AND ${due}`)
  if (bucket === 'receipts')
    return tx.$executeRaw(Prisma.sql`
    DELETE FROM core.mfa_operations AS o USING core.mfa_flows f
    WHERE f.id = o."flowId" AND o.id IN (${ids}) AND ${due}`)
  if (bucket === 'flows')
    return tx.$executeRaw(Prisma.sql`
    DELETE FROM core.mfa_flows AS f WHERE f.id IN (${ids}) AND ${due}`)
  if (bucket === 'families')
    return tx.$executeRaw(Prisma.sql`
    DELETE FROM core.auth_session_families AS f WHERE f.id IN (${ids}) AND ${due}`)
  return tx.$executeRaw(Prisma.sql`
    DELETE FROM core.browser_auth_contexts AS c WHERE c.id IN (${ids}) AND ${due}`)
}
