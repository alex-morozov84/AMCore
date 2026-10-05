-- AI run ownership epochs, attempt history, tool action identity and the effect-unknown status.
--
-- MAINTENANCE-STOP GUARD: the AI run state machine changes meaning in this release (retry budget,
-- ownership fencing, tool outcome handling). Old application code must not write AI state while it
-- is applied. Stop every old `web`, `worker` and `all` process first; this check then fails the
-- migration BEFORE any change if one is still connected (application names are set per process role).
-- If it trips: stop the writer, run `prisma migrate resolve --rolled-back
-- 20261005120000_ai_run_ownership_and_effect_identity`, then deploy again.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_stat_activity
    WHERE datname = current_database()
      AND application_name IN ('amcore-web', 'amcore-worker', 'amcore-all')
      AND pid <> pg_backend_pid()
  ) THEN
    RAISE EXCEPTION 'ai_run_migration_old_writers_connected: stop every amcore-web / amcore-worker / amcore-all process before applying this migration';
  END IF;
END
$$;

-- CreateEnum
CREATE TYPE "ai"."AiRunAttemptOutcome" AS ENUM ('SUCCEEDED', 'RETRY_SCHEDULED', 'FAILED', 'CANCELLED', 'EXPIRED', 'SUPERSEDED', 'AWAITING_APPROVAL', 'LEASE_LOST', 'REAPED', 'EFFECT_UNKNOWN');

-- AlterEnum
ALTER TYPE "ai"."AiToolInvocationStatus" ADD VALUE 'OUTCOME_UNKNOWN';

-- AlterTable
ALTER TABLE "ai"."ai_runs" ADD COLUMN     "inputFingerprint" TEXT,
ADD COLUMN     "leaseEpoch" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ai"."ai_tool_invocations" ADD COLUMN     "appliedAt" TIMESTAMP(3),
ADD COLUMN     "executionEpoch" INTEGER,
ADD COLUMN     "idempotency" TEXT,
ADD COLUMN     "originCall" INTEGER;

-- CreateTable
CREATE TABLE "ai"."ai_run_attempts" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ioStartedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "outcome" "ai"."AiRunAttemptOutcome",
    "errorCode" TEXT,

    CONSTRAINT "ai_run_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_run_attempts_runId_epoch_key" ON "ai"."ai_run_attempts"("runId", "epoch");

-- CreateIndex
CREATE UNIQUE INDEX "ai_tool_invocations_runId_originCall_key" ON "ai"."ai_tool_invocations"("runId", "originCall");

-- AddForeignKey
ALTER TABLE "ai"."ai_run_attempts" ADD CONSTRAINT "ai_run_attempts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ai"."ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
