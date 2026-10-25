-- CreateTable
CREATE TABLE "core"."mfa_accounts" (
    "userId" TEXT NOT NULL,
    "securityVersion" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "setupComplete" BOOLEAN NOT NULL DEFAULT false,
    "codeGeneration" INTEGER NOT NULL DEFAULT 0,
    "emergencyRequired" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "mfa_accounts_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "core"."mfa_protocol" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "state" TEXT NOT NULL DEFAULT 'prepared',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mfa_protocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."mfa_factors" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedSeed" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastAcceptedStep" BIGINT NOT NULL DEFAULT -1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."mfa_recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."auth_session_families" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "securityVersion" INTEGER NOT NULL,
    "primaryMethod" TEXT NOT NULL DEFAULT 'password',
    "primaryAt" TIMESTAMP(3),
    "mfaMethod" TEXT,
    "mfaAt" TIMESTAMP(3),
    "factorVersion" INTEGER,
    "recoveryGeneration" INTEGER,
    "publicationState" TEXT NOT NULL DEFAULT 'pending',
    "receiptHash" TEXT,
    "publicationDeadline" TIMESTAMP(3),
    "browserContextId" TEXT,
    "publicationGeneration" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_session_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."browser_auth_contexts" (
    "id" TEXT NOT NULL,
    "bindingHash" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'empty',
    "reservedFlowId" TEXT,
    "currentFamilyId" TEXT,
    "stagedBindingHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "browser_auth_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."mfa_flows" (
    "id" TEXT NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "authorityKind" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "bindingHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "securityVersion" INTEGER NOT NULL,
    "sourceFamilyId" TEXT,
    "sourceSecurityVersion" INTEGER,
    "browserContextId" TEXT,
    "publicationGeneration" INTEGER,
    "primaryAt" TIMESTAMP(3),
    "mfaAt" TIMESTAMP(3),
    "mfaMethod" TEXT,
    "factorVersion" INTEGER,
    "recoveryGeneration" INTEGER,
    "transferId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."mfa_operations" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."mfa_attempt_budgets" (
    "userId" TEXT NOT NULL,
    "failures" JSONB NOT NULL DEFAULT '[]',
    "starts" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mfa_attempt_budgets_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "mfa_factors_userId_key" ON "core"."mfa_factors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_hash_key" ON "core"."mfa_recovery_codes"("hash");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_userId_generation_idx" ON "core"."mfa_recovery_codes"("userId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_families_receiptHash_key" ON "core"."auth_session_families"("receiptHash");

-- CreateIndex
CREATE INDEX "auth_session_families_userId_revokedAt_idx" ON "core"."auth_session_families"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "auth_session_families_publicationState_publicationDeadline_idx" ON "core"."auth_session_families"("publicationState", "publicationDeadline");

-- CreateIndex
CREATE UNIQUE INDEX "browser_auth_contexts_bindingHash_key" ON "core"."browser_auth_contexts"("bindingHash");

-- CreateIndex
CREATE INDEX "browser_auth_contexts_expiresAt_idx" ON "core"."browser_auth_contexts"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_flows_credentialHash_key" ON "core"."mfa_flows"("credentialHash");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_flows_transferId_key" ON "core"."mfa_flows"("transferId");

-- CreateIndex
CREATE INDEX "mfa_flows_userId_expiresAt_idx" ON "core"."mfa_flows"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "mfa_flows_expiresAt_idx" ON "core"."mfa_flows"("expiresAt");

-- CreateIndex
CREATE INDEX "mfa_operations_createdAt_idx" ON "core"."mfa_operations"("createdAt");

-- AddForeignKey
ALTER TABLE "core"."mfa_accounts" ADD CONSTRAINT "mfa_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."mfa_factors" ADD CONSTRAINT "mfa_factors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."auth_session_families" ADD CONSTRAINT "auth_session_families_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."auth_session_families" ADD CONSTRAINT "auth_session_families_browserContextId_fkey" FOREIGN KEY ("browserContextId") REFERENCES "core"."browser_auth_contexts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."mfa_flows" ADD CONSTRAINT "mfa_flows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."mfa_operations" ADD CONSTRAINT "mfa_operations_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "core"."mfa_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."mfa_attempt_budgets" ADD CONSTRAINT "mfa_attempt_budgets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
