-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "notifications";

-- CreateEnum
CREATE TYPE "notifications"."NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRY_SCHEDULED', 'DELIVERED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "notifications"."NotificationAttemptOutcome" AS ENUM ('DELIVERED', 'TRANSIENT_FAILURE', 'PERMANENT_FAILURE', 'ABANDONED');

-- CreateTable
CREATE TABLE "notifications"."notifications" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "organizationId" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "action" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "idempotencyFingerprint" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications"."notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "targetRef" TEXT,
    "destinationSnapshot" JSONB,
    "locale" TEXT NOT NULL,
    "status" "notifications"."NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "lastErrorCode" TEXT,
    "terminalReasonCode" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications"."notification_delivery_attempts" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "leaseToken" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "outcome" "notifications"."NotificationAttemptOutcome",
    "errorCode" TEXT,
    "providerMessageId" TEXT,

    CONSTRAINT "notification_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications"."notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipientUserId_archivedAt_createdAt_id_idx" ON "notifications"."notifications"("recipientUserId", "archivedAt", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "notifications_recipientUserId_readAt_archivedAt_idx" ON "notifications"."notifications"("recipientUserId", "readAt", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_recipientUserId_idempotencyKey_key" ON "notifications"."notifications"("recipientUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_availableAt_idx" ON "notifications"."notification_deliveries"("status", "availableAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_nextAttemptAt_idx" ON "notifications"."notification_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_leaseExpiresAt_idx" ON "notifications"."notification_deliveries"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notificationId_channel_targetKey_key" ON "notifications"."notification_deliveries"("notificationId", "channel", "targetKey");

-- CreateIndex
CREATE UNIQUE INDEX "notification_delivery_attempts_deliveryId_attemptNumber_key" ON "notifications"."notification_delivery_attempts"("deliveryId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_category_channel_key" ON "notifications"."notification_preferences"("userId", "category", "channel");

-- AddForeignKey
ALTER TABLE "notifications"."notifications" ADD CONSTRAINT "notifications_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications"."notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "core"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"."notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications"."notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "notifications"."notification_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications"."notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
