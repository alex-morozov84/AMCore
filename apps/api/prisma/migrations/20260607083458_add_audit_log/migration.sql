-- CreateEnum
CREATE TYPE "core"."AuditActorType" AS ENUM ('USER', 'API_KEY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "core"."AuditTargetType" AS ENUM ('USER', 'API_KEY', 'ORG_INVITE', 'ORGANIZATION', 'SESSION', 'CLEANUP');

-- CreateEnum
CREATE TYPE "core"."AuditCategory" AS ENUM ('SECURITY', 'BUSINESS');

-- CreateTable
CREATE TABLE "core"."audit_log" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "core"."AuditActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" "core"."AuditTargetType",
    "targetId" TEXT,
    "organizationId" TEXT,
    "requestId" TEXT,
    "ip" TEXT,
    "category" "core"."AuditCategory" NOT NULL DEFAULT 'SECURITY',
    "metadata" JSONB NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "core"."audit_log" USING BRIN ("createdAt");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_id_idx" ON "core"."audit_log"("createdAt", "id");

-- CreateIndex
CREATE INDEX "audit_log_actorId_idx" ON "core"."audit_log"("actorId");

-- CreateIndex
CREATE INDEX "audit_log_targetId_idx" ON "core"."audit_log"("targetId");

-- CreateIndex
CREATE INDEX "audit_log_organizationId_idx" ON "core"."audit_log"("organizationId");

-- CreateFunction
CREATE OR REPLACE FUNCTION "core"."reject_audit_log_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'core.audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

-- CreateTrigger
CREATE TRIGGER "audit_log_reject_update_delete"
BEFORE UPDATE OR DELETE ON "core"."audit_log"
FOR EACH ROW
EXECUTE FUNCTION "core"."reject_audit_log_mutation"();

-- CreateTrigger
CREATE TRIGGER "audit_log_reject_truncate"
BEFORE TRUNCATE ON "core"."audit_log"
FOR EACH STATEMENT
EXECUTE FUNCTION "core"."reject_audit_log_mutation"();
