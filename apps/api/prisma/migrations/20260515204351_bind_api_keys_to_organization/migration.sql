-- Per ADR-033: API keys are organization-scoped credentials.
-- ApiKey.organizationId is required. Any pre-existing rows (e.g. in local
-- dev databases) have no organization context and are invalid by this
-- contract; they are removed before adding the NOT NULL column so the
-- migration is deterministic across environments. Production deploys of
-- this starter have no existing api_keys data (Phase 3 just shipped).

DELETE FROM "core"."api_keys";

-- AlterTable
ALTER TABLE "core"."api_keys" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "api_keys_organizationId_idx" ON "core"."api_keys"("organizationId");

-- AddForeignKey
ALTER TABLE "core"."api_keys" ADD CONSTRAINT "api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
