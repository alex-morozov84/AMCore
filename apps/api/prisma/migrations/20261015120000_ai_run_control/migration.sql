-- Old workers do not honor the claim gate. Stop all writers before this migration.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
    AND pid <> pg_backend_pid()
    AND application_name IN ('amcore-web', 'amcore-worker', 'amcore-all')) THEN
    RAISE EXCEPTION 'ai_run_control_old_writers_connected';
  END IF;
END $$;

CREATE TABLE ai.ai_run_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused BOOLEAN NOT NULL DEFAULT false,
  revision INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO ai.ai_run_control (id) VALUES (1);

ALTER TABLE ai.ai_runs
  ADD COLUMN incarnation UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN "controlRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inputMessageId" TEXT,
  ADD COLUMN "retryOfRunId" TEXT,
  ADD COLUMN "assistantBindingCaptured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "assistantIdAtCreation" TEXT;
ALTER TABLE ai.ai_messages ADD COLUMN "archivedRunId" TEXT;

CREATE TABLE ai.ai_run_tombstones (
  id TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "inputMessageId" TEXT NOT NULL UNIQUE,
  "inputFingerprint" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "terminalStatus" ai."AiRunStatus" NOT NULL,
  "terminalReasonCode" TEXT,
  "finishedAt" TIMESTAMPTZ(3) NOT NULL,
  "archivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "cleanupActorId" TEXT NOT NULL,
  "cleanupCommandId" TEXT NOT NULL,
  CONSTRAINT ai_run_tombstone_conversation_fk FOREIGN KEY ("conversationId")
    REFERENCES ai.ai_conversations(id) ON DELETE CASCADE,
  CONSTRAINT ai_run_tombstone_input_fk FOREIGN KEY ("inputMessageId")
    REFERENCES ai.ai_messages(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX ai_runs_retryOfRunId_key ON ai.ai_runs("retryOfRunId");
CREATE INDEX ai_runs_status_createdAt_id_idx ON ai.ai_runs(status, "createdAt" DESC, id DESC);
CREATE UNIQUE INDEX ai_run_tombstones_conversationId_idempotencyKey_key
  ON ai.ai_run_tombstones("conversationId", "idempotencyKey");
CREATE INDEX ai_messages_archivedRunId_idx ON ai.ai_messages("archivedRunId");

ALTER TABLE ai.ai_runs ADD CONSTRAINT ai_runs_inputMessageId_fkey
  FOREIGN KEY ("inputMessageId") REFERENCES ai.ai_messages(id) ON DELETE SET NULL;
ALTER TABLE ai.ai_runs ADD CONSTRAINT ai_runs_retryOfRunId_fkey
  FOREIGN KEY ("retryOfRunId") REFERENCES ai.ai_runs(id) ON DELETE RESTRICT;
ALTER TABLE ai.ai_messages ADD CONSTRAINT ai_messages_archivedRunId_fkey
  FOREIGN KEY ("archivedRunId") REFERENCES ai.ai_run_tombstones(id) ON DELETE SET NULL;
COMMIT;
