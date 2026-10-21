-- CreateTable
CREATE TABLE "core"."scheduled_job_summaries" (
    "jobId" VARCHAR(64) NOT NULL,
    "firstRegisteredAt" TIMESTAMPTZ(3) NOT NULL,
    "lastRegisteredAt" TIMESTAMPTZ(3) NOT NULL,
    "configVersion" VARCHAR(64) NOT NULL,
    "scheduleTimeZone" VARCHAR(64),
    "enabled" BOOLEAN NOT NULL,
    "disabledReason" VARCHAR(48),
    "nextFireAt" TIMESTAMPTZ(3),
    "baselineDueAt" TIMESTAMPTZ(3),
    "droppedEvents" INTEGER NOT NULL DEFAULT 0,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "successStartedAt" TIMESTAMPTZ(3),
    "successRunId" UUID,
    "successFinishedAt" TIMESTAMPTZ(3),
    "successDurationMs" INTEGER,
    "successCode" VARCHAR(48),
    "successSummary" JSONB,
    "successDueAt" TIMESTAMPTZ(3),
    "successConfigVersion" VARCHAR(64),
    "partialStartedAt" TIMESTAMPTZ(3),
    "partialRunId" UUID,
    "partialFinishedAt" TIMESTAMPTZ(3),
    "partialDurationMs" INTEGER,
    "partialCode" VARCHAR(48),
    "partialSummary" JSONB,
    "failureStartedAt" TIMESTAMPTZ(3),
    "failureRunId" UUID,
    "failureFinishedAt" TIMESTAMPTZ(3),
    "failureDurationMs" INTEGER,
    "failureCode" VARCHAR(48),
    "failureSummary" JSONB,
    "skipStartedAt" TIMESTAMPTZ(3),
    "skipRunId" UUID,
    "skipReason" VARCHAR(48),

    CONSTRAINT "scheduled_job_summaries_pkey" PRIMARY KEY ("jobId")
);

-- CreateTable
CREATE TABLE "core"."scheduled_job_runs" (
    "runId" UUID NOT NULL,
    "jobId" VARCHAR(64) NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "outcome" VARCHAR(16),
    "durationMs" INTEGER,
    "code" VARCHAR(48),
    "summary" JSONB,

    CONSTRAINT "scheduled_job_runs_pkey" PRIMARY KEY ("runId")
);

-- CreateIndex
CREATE INDEX "scheduled_job_runs_jobId_startedAt_idx" ON "core"."scheduled_job_runs"("jobId", "startedAt" DESC);

-- Prisma 7 cannot express CHECK constraints yet (database-features reference); added by hand.
-- Each outcome snapshot is written whole: its key pair is both null or both set, and an empty
-- snapshot carries no other evidence.
ALTER TABLE "core"."scheduled_job_summaries"
  ADD CONSTRAINT "scheduled_job_summaries_success_snapshot_check" CHECK (
    ("successStartedAt" IS NULL) = ("successRunId" IS NULL)
    AND ("successStartedAt" IS NOT NULL OR (
      "successFinishedAt" IS NULL AND "successDurationMs" IS NULL AND "successCode" IS NULL
      AND "successSummary" IS NULL AND "successDueAt" IS NULL AND "successConfigVersion" IS NULL))
    AND octet_length("successSummary"::text) <= 512),
  ADD CONSTRAINT "scheduled_job_summaries_partial_snapshot_check" CHECK (
    ("partialStartedAt" IS NULL) = ("partialRunId" IS NULL)
    AND ("partialStartedAt" IS NOT NULL OR (
      "partialFinishedAt" IS NULL AND "partialDurationMs" IS NULL AND "partialCode" IS NULL
      AND "partialSummary" IS NULL))
    AND octet_length("partialSummary"::text) <= 512),
  ADD CONSTRAINT "scheduled_job_summaries_failure_snapshot_check" CHECK (
    ("failureStartedAt" IS NULL) = ("failureRunId" IS NULL)
    AND ("failureStartedAt" IS NOT NULL OR (
      "failureFinishedAt" IS NULL AND "failureDurationMs" IS NULL AND "failureCode" IS NULL
      AND "failureSummary" IS NULL))
    AND octet_length("failureSummary"::text) <= 512),
  ADD CONSTRAINT "scheduled_job_summaries_skip_snapshot_check" CHECK (
    ("skipStartedAt" IS NULL) = ("skipRunId" IS NULL)
    AND ("skipStartedAt" IS NULL) = ("skipReason" IS NULL)
    AND ("skipReason" IS NULL OR "skipReason" IN ('lock_unavailable', 'not_ready', 'shutdown', 'busy'))),
  ADD CONSTRAINT "scheduled_job_summaries_dropped_check" CHECK ("droppedEvents" >= 0);

-- Run classes: open (outcome null, not finished), abandoned ('unknown', not finished),
-- terminal (success / partial / failed, finished).
ALTER TABLE "core"."scheduled_job_runs"
  ADD CONSTRAINT "scheduled_job_runs_outcome_check" CHECK (
    "outcome" IS NULL OR "outcome" IN ('success', 'partial', 'failed', 'unknown')),
  ADD CONSTRAINT "scheduled_job_runs_finish_check" CHECK (
    ("outcome" IS NOT NULL AND "outcome" <> 'unknown') = ("finishedAt" IS NOT NULL)),
  ADD CONSTRAINT "scheduled_job_runs_summary_check" CHECK (octet_length("summary"::text) <= 512);
