-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ai";

-- CreateEnum
CREATE TYPE "ai"."AiProviderType" AS ENUM ('ANTHROPIC', 'OPENAI', 'OPENROUTER', 'OPENAI_COMPATIBLE', 'YANDEX_AI_STUDIO', 'MOCK');

-- CreateEnum
CREATE TYPE "ai"."AiConversationState" AS ENUM ('ACTIVE', 'PAUSED_FOR_HUMAN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ai"."AiConversationControl" AS ENUM ('BOT', 'HUMAN');

-- CreateEnum
CREATE TYPE "ai"."AiMessageRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "ai"."AiAuthorType" AS ENUM ('USER', 'ASSISTANT', 'OPERATOR', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ai"."AiRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ai"."AiRunStepType" AS ENUM ('PROVIDER_CALL', 'GUARDRAIL_CHECK', 'TOOL_INVOCATION', 'OUTPUT_VALIDATION', 'REFUSAL', 'FINALIZATION');

-- CreateEnum
CREATE TYPE "ai"."AiToolInvocationStatus" AS ENUM ('REQUESTED', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ai"."AiToolRiskClass" AS ENUM ('SAFE', 'SENSITIVE', 'DESTRUCTIVE');

-- CreateEnum
CREATE TYPE "ai"."AiApprovalKind" AS ENUM ('TOOL_INVOCATION', 'HANDOFF', 'SENSITIVE_ACTION');

-- CreateEnum
CREATE TYPE "ai"."AiApprovalState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ai"."AiArtifactKind" AS ENUM ('FILE', 'IMAGE', 'PDF', 'GENERATED_IMAGE', 'TOOL_RESULT');

-- CreateEnum
CREATE TYPE "ai"."AiArtifactTrustLevel" AS ENUM ('TRUSTED', 'UNTRUSTED');

-- CreateTable
CREATE TABLE "ai"."ai_providers" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "ai"."AiProviderType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dataRetentionClass" TEXT NOT NULL DEFAULT 'provider_default',
    "credentialRef" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."ai_models" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "providerModelName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "capabilities" JSONB NOT NULL,
    "contextLimit" INTEGER,
    "maxOutputTokens" INTEGER,
    "priceSnapshot" JSONB,
    "deprecatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."ai_model_policies" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "allowedUseCases" TEXT[],
    "maxTokens" INTEGER,
    "dataRetentionRequired" BOOLEAN NOT NULL DEFAULT false,
    "fallbackEligible" BOOLEAN NOT NULL DEFAULT true,
    "flags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_model_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."ai_assistants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "systemPrompt" TEXT,
    "modelSelection" JSONB NOT NULL,
    "allowedModalities" TEXT[],
    "toolAllowlist" TEXT[],
    "guardrailPolicy" JSONB,
    "budgetClass" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_assistants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."ai_conversations" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "organizationId" TEXT,
    "assistantId" TEXT,
    "title" TEXT,
    "state" "ai"."AiConversationState" NOT NULL DEFAULT 'ACTIVE',
    "controlledBy" "ai"."AiConversationControl" NOT NULL DEFAULT 'BOT',
    "ownershipGeneration" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."ai_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "runId" TEXT,
    "sequence" INTEGER NOT NULL,
    "role" "ai"."AiMessageRole" NOT NULL,
    "authorType" "ai"."AiAuthorType" NOT NULL,
    "authorUserId" TEXT,
    "content" JSONB NOT NULL,
    "redactionMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."ai_runs" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "ai"."AiRunStatus" NOT NULL DEFAULT 'QUEUED',
    "modelSnapshot" JSONB NOT NULL,
    "budgetSnapshot" JSONB,
    "idempotencyKey" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3),
    "cancellationRequestedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "terminalReasonCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."ai_run_steps" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "type" "ai"."AiRunStepType" NOT NULL,
    "detail" JSONB,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "ai_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."ai_tool_invocations" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "status" "ai"."AiToolInvocationStatus" NOT NULL DEFAULT 'REQUESTED',
    "riskClass" "ai"."AiToolRiskClass" NOT NULL DEFAULT 'SAFE',
    "approvalId" TEXT,
    "argsSnapshot" JSONB,
    "resultSummary" JSONB,
    "errorCode" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_tool_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."ai_approvals" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "runId" TEXT,
    "kind" "ai"."AiApprovalKind" NOT NULL,
    "state" "ai"."AiApprovalState" NOT NULL DEFAULT 'PENDING',
    "requestedReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."ai_artifacts" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "runId" TEXT,
    "messageId" TEXT,
    "kind" "ai"."AiArtifactKind" NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "trustLevel" "ai"."AiArtifactTrustLevel" NOT NULL DEFAULT 'UNTRUSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai"."ai_usage_ledger" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "conversationId" TEXT,
    "userId" TEXT,
    "organizationId" TEXT,
    "apiKeyId" TEXT,
    "modelSlug" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(18,8),
    "currency" TEXT,
    "providerReportedUsage" JSONB,
    "usageVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_providers_slug_key" ON "ai"."ai_providers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_slug_key" ON "ai"."ai_models"("slug");

-- CreateIndex
CREATE INDEX "ai_models_providerId_idx" ON "ai"."ai_models"("providerId");

-- CreateIndex
CREATE INDEX "ai_models_enabled_priority_idx" ON "ai"."ai_models"("enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_policies_modelId_key" ON "ai"."ai_model_policies"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_assistants_slug_version_key" ON "ai"."ai_assistants"("slug", "version");

-- CreateIndex
CREATE INDEX "ai_conversations_ownerUserId_createdAt_id_idx" ON "ai"."ai_conversations"("ownerUserId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "ai_conversations_organizationId_idx" ON "ai"."ai_conversations"("organizationId");

-- CreateIndex
CREATE INDEX "ai_messages_runId_idx" ON "ai"."ai_messages"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_messages_conversationId_sequence_key" ON "ai"."ai_messages"("conversationId", "sequence");

-- CreateIndex
CREATE INDEX "ai_runs_conversationId_idx" ON "ai"."ai_runs"("conversationId");

-- CreateIndex
CREATE INDEX "ai_runs_status_availableAt_idx" ON "ai"."ai_runs"("status", "availableAt");

-- CreateIndex
CREATE INDEX "ai_runs_status_nextAttemptAt_idx" ON "ai"."ai_runs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ai_runs_status_leaseExpiresAt_idx" ON "ai"."ai_runs"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_runs_conversationId_idempotencyKey_key" ON "ai"."ai_runs"("conversationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_run_steps_runId_stepNumber_key" ON "ai"."ai_run_steps"("runId", "stepNumber");

-- CreateIndex
CREATE INDEX "ai_tool_invocations_runId_idx" ON "ai"."ai_tool_invocations"("runId");

-- CreateIndex
CREATE INDEX "ai_tool_invocations_approvalId_idx" ON "ai"."ai_tool_invocations"("approvalId");

-- CreateIndex
CREATE INDEX "ai_approvals_conversationId_idx" ON "ai"."ai_approvals"("conversationId");

-- CreateIndex
CREATE INDEX "ai_approvals_runId_idx" ON "ai"."ai_approvals"("runId");

-- CreateIndex
CREATE INDEX "ai_approvals_state_idx" ON "ai"."ai_approvals"("state");

-- CreateIndex
CREATE INDEX "ai_artifacts_conversationId_idx" ON "ai"."ai_artifacts"("conversationId");

-- CreateIndex
CREATE INDEX "ai_artifacts_runId_idx" ON "ai"."ai_artifacts"("runId");

-- CreateIndex
CREATE INDEX "ai_usage_ledger_userId_createdAt_idx" ON "ai"."ai_usage_ledger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_ledger_organizationId_createdAt_idx" ON "ai"."ai_usage_ledger"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_ledger_runId_idx" ON "ai"."ai_usage_ledger"("runId");

-- AddForeignKey
ALTER TABLE "ai"."ai_models" ADD CONSTRAINT "ai_models_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ai"."ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_model_policies" ADD CONSTRAINT "ai_model_policies_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ai"."ai_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_conversations" ADD CONSTRAINT "ai_conversations_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_conversations" ADD CONSTRAINT "ai_conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "core"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_conversations" ADD CONSTRAINT "ai_conversations_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "ai"."ai_assistants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai"."ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_messages" ADD CONSTRAINT "ai_messages_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ai"."ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_runs" ADD CONSTRAINT "ai_runs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai"."ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_run_steps" ADD CONSTRAINT "ai_run_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ai"."ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_tool_invocations" ADD CONSTRAINT "ai_tool_invocations_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ai"."ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_tool_invocations" ADD CONSTRAINT "ai_tool_invocations_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "ai"."ai_approvals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_approvals" ADD CONSTRAINT "ai_approvals_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai"."ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_approvals" ADD CONSTRAINT "ai_approvals_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ai"."ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_approvals" ADD CONSTRAINT "ai_approvals_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "core"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_artifacts" ADD CONSTRAINT "ai_artifacts_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai"."ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_artifacts" ADD CONSTRAINT "ai_artifacts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ai"."ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ai"."ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai"."ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "core"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
