-- AlterTable
ALTER TABLE "core"."auth_session_families" ADD COLUMN     "mfaProofId" TEXT,
ADD COLUMN     "primaryProofId" TEXT;
