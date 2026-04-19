-- AlterTable
ALTER TABLE "core"."sessions"
ADD COLUMN "familyId" TEXT,
ADD COLUMN "revokedAt" TIMESTAMP(3),
ADD COLUMN "revocationReason" TEXT;

-- Backfill existing rows into one-session families
UPDATE "core"."sessions"
SET "familyId" = "id"
WHERE "familyId" IS NULL;

-- Make familyId required after backfill
ALTER TABLE "core"."sessions"
ALTER COLUMN "familyId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "sessions_familyId_idx" ON "core"."sessions"("familyId");
