ALTER TYPE "core"."AuditTargetType" ADD VALUE 'BACKGROUND_WORK';

-- CreateTable
CREATE TABLE "core"."background_work_control" (
    "workId" VARCHAR(64) NOT NULL,
    "desiredSequence" BIGINT NOT NULL DEFAULT 0,
    "desiredPaused" BOOLEAN NOT NULL DEFAULT false,
    "observedEpoch" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "background_work_control_pkey" PRIMARY KEY ("workId")
);

-- CreateTable
CREATE TABLE "core"."background_commands" (
    "actorId" VARCHAR(64) NOT NULL,
    "commandId" UUID NOT NULL,
    "workId" VARCHAR(64) NOT NULL,
    "operation" VARCHAR(16) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "reason" VARCHAR(250) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "logicalBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchUntil" TIMESTAMPTZ(3) NOT NULL,
    "finalizedAt" TIMESTAMPTZ(3),

    CONSTRAINT "background_commands_pkey" PRIMARY KEY ("actorId","commandId")
);

-- CreateTable
CREATE TABLE "core"."background_command_targets" (
    "workId" VARCHAR(64) NOT NULL,
    "actorId" VARCHAR(64) NOT NULL,
    "commandId" UUID NOT NULL,
    "targetId" VARCHAR(128) NOT NULL,
    "incarnation" UUID,
    "queueEpoch" UUID,
    "state" VARCHAR(16) NOT NULL DEFAULT 'prepared',
    "resolution" VARCHAR(32) NOT NULL DEFAULT 'none',
    "dispatchId" UUID,
    "reason" VARCHAR(64),
    "snapshot" JSONB NOT NULL,
    "logicalBytes" INTEGER NOT NULL,
    "dispatchAfter" TIMESTAMPTZ(3),
    "dispatchUntil" TIMESTAMPTZ(3),
    "finalizedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "background_command_targets_pkey" PRIMARY KEY ("actorId","commandId","targetId")
);

-- CreateTable
CREATE TABLE "core"."background_budgets" (
    "key" VARCHAR(192) NOT NULL,
    "commands" INTEGER NOT NULL DEFAULT 0,
    "targets" INTEGER NOT NULL DEFAULT 0,
    "logicalBytes" BIGINT NOT NULL DEFAULT 0,
    "activeCommands" INTEGER NOT NULL DEFAULT 0,
    "activeTargets" INTEGER NOT NULL DEFAULT 0,
    "unknownTargets" INTEGER NOT NULL DEFAULT 0,
    "evidenceRows" INTEGER NOT NULL DEFAULT 0,
    "evidenceBytes" BIGINT NOT NULL DEFAULT 0,
    "unresolvedRows" INTEGER NOT NULL DEFAULT 0,
    "actorBudgetRows" INTEGER NOT NULL DEFAULT 0,
    "virtualTime" JSONB NOT NULL DEFAULT '{}',
    "lastObservedTime" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "background_budgets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "core"."background_effect_evidence" (
    "workId" VARCHAR(64) NOT NULL,
    "incarnation" UUID NOT NULL,
    "jobId" VARCHAR(128) NOT NULL,
    "queueEpoch" UUID NOT NULL,
    "jobName" VARCHAR(64) NOT NULL,
    "wireVersion" INTEGER NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "logicalBytes" INTEGER NOT NULL,
    "requestDigest" CHAR(64),
    "providerScope" CHAR(64),
    "firstDispatchAt" TIMESTAMPTZ(3),
    "nominalDeadline" TIMESTAMPTZ(3),
    "floorUpper" BIGINT NOT NULL DEFAULT 0,
    "clockPolicyVersion" INTEGER NOT NULL DEFAULT 1,
    "autoStartsUsed" INTEGER NOT NULL DEFAULT 0,
    "automaticLimit" INTEGER NOT NULL,
    "manualGrant" VARCHAR(16) NOT NULL DEFAULT 'none',
    "certainty" VARCHAR(16) NOT NULL DEFAULT 'none',
    "unresolvedCount" INTEGER NOT NULL DEFAULT 0,
    "activeAttemptId" UUID,
    "outcomeRecorded" BOOLEAN NOT NULL DEFAULT true,
    "commandFence" UUID,
    "safeResult" JSONB NOT NULL DEFAULT '{}',
    "disposition" VARCHAR(32) NOT NULL DEFAULT 'none',
    "finalizedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "background_effect_evidence_pkey" PRIMARY KEY ("workId","incarnation")
);

-- CreateIndex
CREATE INDEX "background_commands_actorId_createdAt_idx" ON "core"."background_commands"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "background_commands_workId_createdAt_idx" ON "core"."background_commands"("workId", "createdAt");

-- CreateIndex
CREATE INDEX "background_commands_finalizedAt_actorId_commandId_idx" ON "core"."background_commands"("finalizedAt", "actorId", "commandId");

-- CreateIndex
CREATE INDEX "background_command_targets_state_dispatchUntil_idx" ON "core"."background_command_targets"("state", "dispatchUntil");

-- CreateIndex
CREATE INDEX "background_command_targets_incarnation_state_idx" ON "core"."background_command_targets"("incarnation", "state");

-- CreateIndex
CREATE INDEX "background_command_targets_finalizedAt_actorId_commandId_ta_idx" ON "core"."background_command_targets"("finalizedAt", "actorId", "commandId", "targetId");

-- CreateIndex
CREATE INDEX "background_budgets_updatedAt_key_idx" ON "core"."background_budgets"("updatedAt", "key");

-- CreateIndex
CREATE INDEX "background_effect_evidence_workId_createdAt_incarnation_idx" ON "core"."background_effect_evidence"("workId", "createdAt", "incarnation");

-- CreateIndex
CREATE INDEX "background_effect_evidence_finalizedAt_workId_incarnation_idx" ON "core"."background_effect_evidence"("finalizedAt", "workId", "incarnation");

-- AddForeignKey
ALTER TABLE "core"."background_command_targets" ADD CONSTRAINT "background_command_targets_actorId_commandId_fkey" FOREIGN KEY ("actorId", "commandId") REFERENCES "core"."background_commands"("actorId", "commandId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "background_command_targets_workId_state_targetId_incarnation_idx" ON "core"."background_command_targets"("workId", "state", "targetId", "incarnation");

CREATE INDEX "background_effect_evidence_compaction_idx" ON "core"."background_effect_evidence"("certainty", "logicalBytes", "createdAt", "workId", "incarnation");

CREATE INDEX "background_command_targets_compaction_idx" ON "core"."background_command_targets"("state", "logicalBytes", "actorId", "commandId");
