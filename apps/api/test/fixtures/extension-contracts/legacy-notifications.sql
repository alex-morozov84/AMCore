INSERT INTO core.users (id, email, "emailCanonical", "updatedAt")
VALUES ('legacy-owner', 'legacy@example.com', 'legacy@example.com', now());
INSERT INTO notifications.notifications (id, "recipientUserId", type, category, "schemaVersion", payload,
  "idempotencyKey", "idempotencyFingerprint", "occurredAt")
VALUES ('legacy-notification', 'legacy-owner', 'extension.fixture', 'product', 1, '{}', 'extension.fixture:legacy', 'fixture', now());
INSERT INTO notifications.notification_deliveries (id, "notificationId", channel, "targetKey", locale,
  status, "attemptCount", "maxAttempts", "updatedAt")
VALUES
 ('never', 'legacy-notification', 'email', 'never@example.com', 'en', 'PENDING', 0, 5, now()),
 ('reaped', 'legacy-notification', 'email', 'reaped@example.com', 'en', 'PENDING', 1, 5, now()),
 ('zero-with-attempt', 'legacy-notification', 'email', 'zero@example.com', 'en', 'PENDING', 0, 5, now()),
 ('processing', 'legacy-notification', 'telegram', 'processing-chat', 'en', 'PROCESSING', 1, 5, now()),
 ('retry', 'legacy-notification', 'fixture_channel', 'retry-target', 'en', 'RETRY_SCHEDULED', 1, 5, now()),
 ('receipt', 'legacy-notification', 'email', 'receipt@example.com', 'en', 'PENDING', 0, 5, now()),
 ('delivered', 'legacy-notification', 'email', 'delivered@example.com', 'en', 'DELIVERED', 1, 5, now()),
 ('failed', 'legacy-notification', 'email', 'failed@example.com', 'en', 'FAILED', 1, 5, now()),
 ('skipped', 'legacy-notification', 'email', 'skipped@example.com', 'en', 'SKIPPED', 0, 5, now()),
 ('cancelled', 'legacy-notification', 'telegram', 'cancelled-chat', 'en', 'CANCELLED', 1, 5, now()),
 ('in-app', 'legacy-notification', 'in_app', 'feed', 'en', 'DELIVERED', 0, 5, now());
UPDATE notifications.notification_deliveries
SET "leaseToken" = 'legacy-lease', "leaseExpiresAt" = now() + interval '1 hour'
WHERE id = 'processing';
UPDATE notifications.notification_deliveries SET "nextAttemptAt" = '2099-01-01'
WHERE id IN ('retry', 'reaped');
UPDATE notifications.notification_deliveries SET "providerMessageId" = 'retained-receipt', "deliveredAt" = '2026-01-01'
WHERE id = 'receipt';
INSERT INTO notifications.notification_delivery_attempts (id, "deliveryId", "attemptNumber", "leaseToken")
VALUES ('old-attempt-zero', 'zero-with-attempt', 1, 'legacy-lease'),
       ('old-attempt-processing', 'processing', 1, 'legacy-lease');
INSERT INTO notifications.notification_delivery_attempts (id, "deliveryId", "attemptNumber", "leaseToken", outcome, "finishedAt")
VALUES ('old-attempt-reaped', 'reaped', 1, 'legacy-lease', 'ABANDONED', '2026-01-01');
