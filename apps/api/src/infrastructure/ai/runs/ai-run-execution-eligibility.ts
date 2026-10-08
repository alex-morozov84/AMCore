import { AI_RUN_MAX_EPOCHS } from './ai-run.constants'

import { Prisma } from '@/generated/prisma/client'

/** One durable execution predicate shared by claim and due metrics; diagnosis is a separate sweep. */
export function aiRunExecutionEligibility(at: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    status = 'QUEUED'::ai."AiRunStatus" AND "availableAt" <= ${at}
    AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${at})
    AND ("deadlineAt" IS NULL OR "deadlineAt" > ${at})
    AND "leaseEpoch" < ${AI_RUN_MAX_EPOCHS}
    AND (SELECT classification FROM ai.classify_provider_retry_restriction("providerRetryRestriction", ${at})) IN ('unrestricted','due')
  `
}
