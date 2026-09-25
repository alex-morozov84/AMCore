-- PostgreSQL fills old rows with distinct values for this volatile default.
-- The existing append-only triggers remain installed throughout the migration.
ALTER TABLE "core"."audit_log"
  ADD COLUMN "cursorKey" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "audit_log_cursorKey_key" ON "core"."audit_log"("cursorKey");
