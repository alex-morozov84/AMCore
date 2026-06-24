/*
  Warnings:

  - You are about to drop the column `credentialRef` on the `ai_providers` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "ai"."ai_usage_ledger" DROP CONSTRAINT "ai_usage_ledger_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ai"."ai_usage_ledger" DROP CONSTRAINT "ai_usage_ledger_runId_fkey";

-- DropForeignKey
ALTER TABLE "ai"."ai_usage_ledger" DROP CONSTRAINT "ai_usage_ledger_userId_fkey";

-- AlterTable
ALTER TABLE "ai"."ai_providers" DROP COLUMN "credentialRef",
ADD COLUMN     "credentialSlot" TEXT;
