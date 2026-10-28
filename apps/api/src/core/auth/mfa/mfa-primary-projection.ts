import { Prisma } from '../../../generated/prisma/client.js'

import {
  type MfaPrimaryProjection,
  mfaPrimaryProjectionSchema,
} from './mfa-primary-projection.schema.js'

export type MfaProjectionDatabase = Pick<Prisma.TransactionClient, '$queryRaw'>
export type MfaProjectionSelector =
  { userId: string; familyId?: string } | { refreshHash: string; familyId: string }

/** One primary statement, one snapshot and actual DB clock; no cache, seed or proof history. */
export async function readMfaPrimaryProjection(
  db: MfaProjectionDatabase,
  selector: MfaProjectionSelector
): Promise<MfaPrimaryProjection | null> {
  const source =
    'refreshHash' in selector
      ? Prisma.sql`FROM core.sessions s JOIN core.users u ON u.id = s."userId" WHERE s."refreshToken" = ${selector.refreshHash}`
      : Prisma.sql`FROM core.users u LEFT JOIN core.sessions s ON FALSE WHERE u.id = ${selector.userId}`
  const rows = await db.$queryRaw<unknown[]>(Prisma.sql`
    WITH source AS (
      SELECT u.id, u."systemRole", s.id AS "sessionId", s."userId" AS "sessionUserId",
        s."familyId" AS "sessionFamilyId", s."expiresAt" AS "sessionExpiresAt",
        s."revokedAt" AS "sessionRevokedAt", s."revocationReason" AS "sessionRevocationReason"
      ${source}
    )
    SELECT clock_timestamp() AS now,
      jsonb_build_object('id', u.id, 'systemRole', u."systemRole",
        'mfaAccount', CASE WHEN a."userId" IS NULL THEN NULL ELSE jsonb_build_object(
          'securityVersion', a."securityVersion", 'required', a.required,
          'setupComplete', a."setupComplete", 'emergencyRequired', a."emergencyRequired") END,
        'mfaFactor', CASE WHEN mf."userId" IS NULL THEN NULL ELSE jsonb_build_object('version', mf.version) END
      ) AS "user",
      CASE WHEN f.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', f.id, 'userId', f."userId", 'securityVersion', f."securityVersion",
        'expiresAt', f."expiresAt", 'revokedAt', f."revokedAt", 'publicationState', f."publicationState",
        'primaryMethod', f."primaryMethod", 'primaryAt', f."primaryAt", 'primaryProofId', f."primaryProofId",
        'mfaMethod', f."mfaMethod", 'mfaAt', f."mfaAt", 'mfaProofId', f."mfaProofId",
        'factorVersion', f."factorVersion", 'browserContextId', f."browserContextId",
        'publicationGeneration', f."publicationGeneration",
        'browserContext', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
          'bindingHash', c."bindingHash", 'audience', c.audience, 'id', c.id,
          'generation', c.generation, 'currentFamilyId', c."currentFamilyId",
          'state', c.state, 'expiresAt', c."expiresAt") END
      ) END AS family,
      CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('state', p.state, 'version', p.version) END AS protocol,
      CASE WHEN u."sessionId" IS NULL THEN NULL ELSE jsonb_build_object(
        'id', u."sessionId", 'userId', u."sessionUserId", 'familyId', u."sessionFamilyId",
        'expiresAt', u."sessionExpiresAt", 'revokedAt', u."sessionRevokedAt",
        'revocationReason', u."sessionRevocationReason") END AS session
    FROM source u
    LEFT JOIN core.mfa_accounts a ON a."userId" = u.id
    LEFT JOIN core.mfa_factors mf ON mf."userId" = u.id
    LEFT JOIN core.auth_session_families f ON f.id = ${selector.familyId ?? null}
    LEFT JOIN core.browser_auth_contexts c ON c.id = f."browserContextId"
    LEFT JOIN core.mfa_protocol p ON p.id = 'platform'
  `)
  return rows.length ? mfaPrimaryProjectionSchema.parse(rows[0]) : null
}
