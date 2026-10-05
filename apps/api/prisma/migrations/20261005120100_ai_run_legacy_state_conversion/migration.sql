-- State-aware conversion of AI run data written by the previous run engine. Runs in its own migration
-- so the `OUTCOME_UNKNOWN` enum value added by the previous one is committed before it is used.
-- Same maintenance-stop guard as the previous migration (old writers must be stopped).
DO $$
BEGIN
  IF (
    EXISTS (SELECT 1 FROM "ai"."ai_runs") OR EXISTS (SELECT 1 FROM "ai"."ai_tool_invocations")
  ) AND EXISTS (
    SELECT 1 FROM pg_stat_activity
    WHERE datname = current_database()
      AND application_name IN ('amcore-web', 'amcore-worker', 'amcore-all')
      AND pid <> pg_backend_pid()
  ) THEN
    RAISE EXCEPTION 'ai_run_migration_old_writers_connected: stop every amcore-web / amcore-worker / amcore-all process before applying this migration';
  END IF;
END
$$;

-- 1. Applied marker. A SUCCEEDED/REJECTED invocation that already has its ordering TOOL_INVOCATION step
--    was applied to the transcript. One without a step stays unapplied (a REJECTED one is a genuine
--    pending decision; a SUCCEEDED one cannot be produced by the old atomic commit and fails closed at
--    runtime). Nothing is fabricated.
UPDATE "ai"."ai_tool_invocations" AS i
SET "appliedAt" = s."appliedAt"
FROM (
  SELECT detail ->> 'invocationId' AS "invocationId",
         COALESCE(min("finishedAt"), min("startedAt")) AS "appliedAt"
  FROM "ai"."ai_run_steps"
  WHERE type = 'TOOL_INVOCATION'::"ai"."AiRunStepType" AND detail ->> 'invocationId' IS NOT NULL
  GROUP BY detail ->> 'invocationId'
) AS s
WHERE i.id = s."invocationId"
  AND i.status IN ('SUCCEEDED'::"ai"."AiToolInvocationStatus", 'REJECTED'::"ai"."AiToolInvocationStatus")
  AND i."appliedAt" IS NULL;

-- 2. Retry budget. Old `attemptCount` counted claims (decremented on an approval decision); the new one
--    counts consumed retries. QUEUED rows already equal consumed retries (a retry-scheduled row holds its
--    failed claims; an approval-resumed row had its parking claim decremented). A RUNNING or
--    WAITING_APPROVAL row still counts its current/parking claim, which is not a retry.
UPDATE "ai"."ai_runs"
SET "attemptCount" = GREATEST(0, "attemptCount" - 1)
WHERE status IN ('RUNNING'::"ai"."AiRunStatus", 'WAITING_APPROVAL'::"ai"."AiRunStatus");

-- 3. Effect certainty. A stranded EXECUTING invocation (any run status) is unresolved: its external
--    effect may have happened. On a non-terminal run a FAILED(tool_execution_failed) invocation is
--    ambiguous too (timeout vs clean error cannot be told apart; the crash window before the run was
--    finalized). Terminal runs keep their status and known evidence; their FAILED rows are not rewritten
--    (a NULL `idempotency` class is always treated as side-effecting by later consumers).
UPDATE "ai"."ai_tool_invocations"
SET status = 'OUTCOME_UNKNOWN'::"ai"."AiToolInvocationStatus",
    "errorCode" = COALESCE("errorCode", 'tool_effect_unknown')
WHERE status = 'EXECUTING'::"ai"."AiToolInvocationStatus";

UPDATE "ai"."ai_tool_invocations" AS i
SET status = 'OUTCOME_UNKNOWN'::"ai"."AiToolInvocationStatus"
FROM "ai"."ai_runs" AS r
WHERE i."runId" = r.id
  AND i.status = 'FAILED'::"ai"."AiToolInvocationStatus"
  AND i."errorCode" = 'tool_execution_failed'
  AND r.status IN (
    'QUEUED'::"ai"."AiRunStatus", 'RUNNING'::"ai"."AiRunStatus",
    'WAITING_APPROVAL'::"ai"."AiRunStatus", 'WAITING_HUMAN'::"ai"."AiRunStatus"
  );
