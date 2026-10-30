CREATE TABLE "core"."mfa_recovery_tickets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "securityVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedByFlowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_recovery_tickets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mfa_recovery_tickets_userId_key" ON "core"."mfa_recovery_tickets"("userId");
CREATE UNIQUE INDEX "mfa_recovery_tickets_credentialHash_key" ON "core"."mfa_recovery_tickets"("credentialHash");
CREATE UNIQUE INDEX "mfa_recovery_tickets_consumedByFlowId_key" ON "core"."mfa_recovery_tickets"("consumedByFlowId");
CREATE INDEX "mfa_recovery_tickets_expiresAt_idx" ON "core"."mfa_recovery_tickets"("expiresAt");
ALTER TABLE "core"."mfa_recovery_tickets" ADD CONSTRAINT "mfa_recovery_tickets_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
