CREATE TABLE "core"."mfa_settings_start_receipts" (
  "operationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceFamilyId" TEXT NOT NULL,
  "sourceSecurityVersion" INTEGER NOT NULL,
  "sourceSessionId" TEXT NOT NULL,
  "browserContextId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "audience" TEXT NOT NULL,
  "bindingHash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "startNotAfter" TIMESTAMP(3) NOT NULL,
  "state" TEXT NOT NULL,
  "flowId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mfa_settings_start_receipts_pkey" PRIMARY KEY ("operationId")
);

CREATE INDEX "mfa_settings_start_receipts_expiresAt_idx" ON "core"."mfa_settings_start_receipts"("expiresAt");

ALTER TABLE "core"."mfa_settings_start_receipts" ADD CONSTRAINT "mfa_settings_start_receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "core"."browser_logout_receipts" (
  "operationId" TEXT NOT NULL,
  "returnEntryId" TEXT NOT NULL,
  "credentialHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceFamilyId" TEXT NOT NULL,
  "securityVersion" INTEGER NOT NULL,
  "sourceSessionId" TEXT NOT NULL,
  "contextId" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "bindingHash" TEXT NOT NULL,
  "beforeGeneration" INTEGER NOT NULL,
  "afterGeneration" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "neutralAttemptId" TEXT,
  "reservedFlowId" TEXT,
  "reservedGeneration" INTEGER,
  "completionId" TEXT,
  "publishedFamilyId" TEXT,
  CONSTRAINT "browser_logout_receipts_pkey" PRIMARY KEY ("operationId")
);

CREATE INDEX "browser_logout_receipts_expiresAt_idx" ON "core"."browser_logout_receipts"("expiresAt");

ALTER TABLE "core"."browser_logout_receipts" ADD CONSTRAINT "browser_logout_receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "browser_logout_receipts_returnEntryId_key" ON "core"."browser_logout_receipts"("returnEntryId");

CREATE UNIQUE INDEX "browser_logout_receipts_neutralAttemptId_key" ON "core"."browser_logout_receipts"("neutralAttemptId");

CREATE UNIQUE INDEX "browser_logout_receipts_reservedFlowId_key" ON "core"."browser_logout_receipts"("reservedFlowId");

CREATE INDEX "browser_logout_receipts_contextId_idx" ON "core"."browser_logout_receipts"("contextId");

CREATE INDEX "mfa_settings_start_receipts_userId_sourceFamilyId_idx" ON "core"."mfa_settings_start_receipts"("userId", "sourceFamilyId");
