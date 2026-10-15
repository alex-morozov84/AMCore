import { Prisma } from '../../../generated/prisma/client.js'

/** List reads never load frozen bodies or destination snapshots across the bounded window. */
export const notificationControlProjection = Prisma.sql`
  id, incarnation, "controlRevision", "notificationId", channel,
  "targetKey", "targetRef", status, "attemptCount", "maxAttempts", "manualGrant",
  "acceptedSeen", "unresolvedEffectCount", "legacyUnverified", "retryableExhaustion",
  "requestContractVersion", ("preparedRequest" IS NOT NULL) AS "preparedRequest",
  "preparedRequestHash", "providerScope", "terminalReasonCode", "lastErrorCode",
  "nextAttemptAt", "terminalAt", "createdAt"
`
