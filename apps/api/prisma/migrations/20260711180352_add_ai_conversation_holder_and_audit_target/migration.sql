-- AlterEnum
ALTER TYPE "core"."AuditTargetType" ADD VALUE 'AI_CONVERSATION';

-- AlterTable
ALTER TABLE "ai"."ai_conversations" ADD COLUMN     "humanControlAcquiredAt" TIMESTAMP(3),
ADD COLUMN     "humanControlUserId" TEXT;
