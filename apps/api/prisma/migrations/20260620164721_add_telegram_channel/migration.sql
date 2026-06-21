-- CreateEnum
CREATE TYPE "notifications"."TelegramConnectionStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateTable
CREATE TABLE "notifications"."telegram_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "status" "notifications"."TelegramConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications"."telegram_link_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications"."telegram_update_receipts" (
    "updateId" BIGINT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_update_receipts_pkey" PRIMARY KEY ("updateId")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_connections_userId_key" ON "notifications"."telegram_connections"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_connections_chatId_key" ON "notifications"."telegram_connections"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_connections_telegramUserId_key" ON "notifications"."telegram_connections"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_link_tokens_tokenHash_key" ON "notifications"."telegram_link_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "telegram_link_tokens_userId_idx" ON "notifications"."telegram_link_tokens"("userId");

-- AddForeignKey
ALTER TABLE "notifications"."telegram_connections" ADD CONSTRAINT "telegram_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications"."telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
