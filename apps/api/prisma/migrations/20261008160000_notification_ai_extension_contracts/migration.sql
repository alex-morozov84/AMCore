-- Maintenance-only upgrade: stop all web/worker/all writers and back up before applying.
-- Prepared content cannot be reconstructed for old attempted work. See deployment guide.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
      AND application_name IN ('amcore-web', 'amcore-worker', 'amcore-all')) THEN
    RAISE EXCEPTION 'extension_contract_migration_old_writers_connected';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "ai"."ai_tool_invocations" ADD COLUMN     "inputSchemaHash" TEXT,
ADD COLUMN     "intentHash" TEXT,
ADD COLUMN     "intentSnapshot" JSONB,
ADD COLUMN     "normalizedSchemaHash" TEXT,
ADD COLUMN     "toolVersion" INTEGER;

-- AlterTable
ALTER TABLE "ai"."ai_approvals" ADD COLUMN     "intentHash" TEXT;

-- AlterTable
ALTER TABLE "notifications"."notification_deliveries" ADD COLUMN     "preparedRequest" JSONB,
ADD COLUMN     "preparedRequestHash" TEXT,
ADD COLUMN     "requestContractVersion" INTEGER;

-- Only positive evidence of never-attempted work permits first preparation under the new contract.
UPDATE notifications.notification_deliveries AS d
SET "requestContractVersion" = 1, "updatedAt" = clock_timestamp()
WHERE d.channel <> 'in_app' AND d.status = 'PENDING'
  AND d."attemptCount" = 0 AND d."leaseToken" IS NULL AND d."leaseExpiresAt" IS NULL
  AND d."providerMessageId" IS NULL AND d."deliveredAt" IS NULL AND d."failedAt" IS NULL
  AND d."nextAttemptAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM notifications.notification_delivery_attempts AS a WHERE a."deliveryId" = d.id);

-- PENDING after a reap is not never-attempted. Preserve counters, retry floors and receipt evidence.
WITH refused AS (
  UPDATE notifications.notification_deliveries
  SET status = 'FAILED', "failedAt" = clock_timestamp(),
      "terminalReasonCode" = 'legacy_request_unavailable',
      "lastErrorCode" = 'legacy_delivery_outcome_unverified',
      "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = clock_timestamp()
  WHERE channel <> 'in_app' AND "requestContractVersion" IS NULL
    AND status IN ('PENDING', 'PROCESSING', 'RETRY_SCHEDULED')
  RETURNING id
)
UPDATE notifications.notification_delivery_attempts AS a
SET "finishedAt" = clock_timestamp(), outcome = 'ABANDONED',
    "errorCode" = 'legacy_delivery_outcome_unverified'
FROM refused AS d WHERE a."deliveryId" = d.id AND a."finishedAt" IS NULL;

-- Unknown effects dominate every missing contract/version/handler/permission failure.
UPDATE ai.ai_tool_invocations
SET status = 'OUTCOME_UNKNOWN', "errorCode" = 'tool_effect_unknown', "finishedAt" = clock_timestamp(), "updatedAt" = clock_timestamp()
WHERE "idempotency" IS DISTINCT FROM 'read_only'
  AND (status = 'EXECUTING' OR
    (status IN ('REQUESTED', 'APPROVED', 'AWAITING_APPROVAL')
      AND ("startedAt" IS NOT NULL OR "executionEpoch" IS NOT NULL)));

UPDATE ai.ai_runs AS r
SET status = 'FAILED', "errorCode" = 'tool_loop_failed', "terminalReasonCode" = 'tool_effect_unknown',
    "finishedAt" = clock_timestamp(), "leaseToken" = NULL, "leaseExpiresAt" = NULL,
    "updatedAt" = clock_timestamp()
WHERE r.status IN ('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_HUMAN')
  AND EXISTS (SELECT 1 FROM ai.ai_tool_invocations i WHERE i."runId" = r.id AND i.status = 'OUTCOME_UNKNOWN');

-- An unapplied success is inconsistent evidence, not an invitation to fabricate a transcript/result.
UPDATE ai.ai_runs AS r
SET status = 'FAILED', "errorCode" = 'tool_loop_failed', "terminalReasonCode" = 'tool_state_inconsistent',
    "finishedAt" = clock_timestamp(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = clock_timestamp()
WHERE r.status IN ('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_HUMAN')
  AND EXISTS (SELECT 1 FROM ai.ai_tool_invocations i
    WHERE i."runId" = r.id AND i.status = 'SUCCEEDED' AND i."appliedAt" IS NULL);

-- Retain decisions/history. Hashless unstarted intent and read-only adoption cannot prove compatibility.
UPDATE ai.ai_tool_invocations
SET status = 'FAILED', "errorCode" = 'tool_schema_incompatible', "finishedAt" = clock_timestamp(), "updatedAt" = clock_timestamp()
WHERE "intentHash" IS NULL AND status IN ('REQUESTED', 'APPROVED', 'AWAITING_APPROVAL', 'EXECUTING');

UPDATE ai.ai_runs AS r
SET status = 'FAILED', "errorCode" = 'tool_loop_failed', "terminalReasonCode" = 'tool_schema_incompatible',
    "finishedAt" = clock_timestamp(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = clock_timestamp()
WHERE r.status IN ('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_HUMAN')
  AND EXISTS (SELECT 1 FROM ai.ai_tool_invocations i
    WHERE i."runId" = r.id AND i."intentHash" IS NULL AND i."errorCode" = 'tool_schema_incompatible');

WITH expired AS (
  UPDATE ai.ai_approvals SET state = 'EXPIRED', "updatedAt" = clock_timestamp()
  WHERE state = 'PENDING' AND "intentHash" IS NULL RETURNING id, "runId"
)
INSERT INTO core.audit_log (id, "actorType", action, "targetType", "targetId", metadata)
SELECT 'pr4' || replace(gen_random_uuid()::text, '-', ''), 'SYSTEM', 'ai.approval.expired',
       'AI_APPROVAL', id, jsonb_build_object('approvalId', id, 'runId', "runId", 'reasonCode', 'legacy_contract_expired')
FROM expired;

UPDATE ai.ai_run_attempts AS a
SET "endedAt" = clock_timestamp(),
    outcome = CASE WHEN r."terminalReasonCode" = 'tool_effect_unknown'
      THEN 'EFFECT_UNKNOWN'::ai."AiRunAttemptOutcome" ELSE 'FAILED'::ai."AiRunAttemptOutcome" END,
    "errorCode" = r."terminalReasonCode"
FROM ai.ai_runs AS r
WHERE a."runId" = r.id AND a."endedAt" IS NULL AND r.status = 'FAILED'
  AND r."terminalReasonCode" IN ('tool_effect_unknown', 'tool_schema_incompatible', 'tool_state_inconsistent');
COMMIT;
