import type { BrowserRevision } from '@amcore/shared'

import type { Prisma } from '../../../generated/prisma/client.js'

/** Count current authority, not lingering rows. Caller holds account and any replaced context locks. */
export async function liveMfaFlows(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
  replacing?: BrowserRevision
): Promise<{ expiresAt: Date }[]> {
  const contextId = replacing?.contextId ?? null
  const generation = replacing?.generation ?? null
  return tx.$queryRaw<{ expiresAt: Date }[]>`
    SELECT CASE WHEN f.state = 'open'
      THEN LEAST(f."expiresAt", b."expiresAt", CASE WHEN f."authorityKind" = 'session' THEN source."expiresAt" END)
      ELSE LEAST(delivery."expiresAt", b."expiresAt") END AS "expiresAt"
    FROM core.mfa_flows f
    JOIN core.mfa_accounts account ON account."userId" = f."userId"
      AND account."securityVersion" = f."securityVersion"
    LEFT JOIN core.browser_auth_contexts b ON b.id = f."browserContextId"
    LEFT JOIN core.auth_session_families source ON source.id = f."sourceFamilyId"
    LEFT JOIN LATERAL (
      SELECT LEAST(candidate."publicationDeadline", candidate."expiresAt", s."expiresAt") AS "expiresAt"
      FROM core.mfa_operations operation
      JOIN core.auth_session_families candidate ON candidate.id = operation.result->>'familyId'
      JOIN core.sessions s ON s.id = operation.result->>'sessionId' AND s."familyId" = candidate.id
      WHERE operation."flowId" = f.id AND operation.kind = 'issue_family'
        AND operation.result->>'kind' = 'issued_family'
        AND candidate."userId" = f."userId" AND s."userId" = f."userId"
        AND candidate."securityVersion" = f."securityVersion"
        AND candidate."browserContextId" IS NOT DISTINCT FROM f."browserContextId"
        AND candidate."publicationGeneration" IS NOT DISTINCT FROM f."publicationGeneration"
        AND candidate."publicationState" = 'pending' AND candidate."revokedAt" IS NULL
        AND s."revokedAt" IS NULL AND s."expiresAt" > ${now}
        AND candidate."expiresAt" > ${now} AND candidate."publicationDeadline" > ${now}
      ORDER BY candidate."publicationDeadline" LIMIT 1
    ) delivery ON f.state = 'committed'
    WHERE f."userId" = ${userId} AND f.state IN ('open', 'committed')
      AND (${contextId}::text IS NULL OR f."browserContextId" IS DISTINCT FROM ${contextId}
        OR f."publicationGeneration" IS DISTINCT FROM ${generation}::integer)
      AND ((f."browserContextId" IS NULL AND f."publicationGeneration" IS NULL)
        OR (b."expiresAt" > ${now} AND b.generation = f."publicationGeneration"
          AND b."bindingHash" = f."bindingHash" AND b.audience = f.audience
          AND ((f."authorityKind" = 'session' AND b.state = 'published'
              AND b."currentFamilyId" = f."sourceFamilyId")
            OR (f."authorityKind" <> 'session' AND b.state = 'reserved'
              AND b."currentFamilyId" IS NULL AND b."reservedFlowId" = f.id))))
      AND ((f.state = 'open' AND f."expiresAt" > ${now}
          AND (f."authorityKind" <> 'session' OR (source."userId" = f."userId"
            AND source."securityVersion" = f."securityVersion"
            AND f."sourceSecurityVersion" = f."securityVersion"
            AND source."revokedAt" IS NULL AND source."expiresAt" > ${now}
            AND source."publicationState" = 'published'
            AND source."browserContextId" IS NOT DISTINCT FROM f."browserContextId"
            AND source."publicationGeneration" IS NOT DISTINCT FROM f."publicationGeneration")))
        OR (f.state = 'committed' AND delivery."expiresAt" > ${now}))
    ORDER BY "expiresAt" LIMIT 3`
}
