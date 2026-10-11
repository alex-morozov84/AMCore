-- Maintenance upgrade: drain and stop all application writers before applying.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
    AND pid <> pg_backend_pid()
    AND application_name IN ('amcore-web', 'amcore-worker', 'amcore-all')) THEN
    RAISE EXCEPTION 'notification_control_old_writers_connected';
  END IF;
END $$;

CREATE TABLE notifications.notification_delivery_control (
  id INTEGER PRIMARY KEY, paused BOOLEAN NOT NULL DEFAULT false,
  revision INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT notification_control_singleton CHECK (id = 1)
);
INSERT INTO notifications.notification_delivery_control VALUES (1, false, 0, clock_timestamp());

ALTER TABLE notifications.notification_deliveries
  ADD COLUMN incarnation UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN "controlRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "manualGrant" VARCHAR(16) NOT NULL DEFAULT 'none',
  ADD COLUMN "grantActorId" VARCHAR(64),
  ADD COLUMN "grantCommandId" UUID,
  ADD COLUMN "grantAttemptNumber" INTEGER,
  ADD COLUMN "retryableExhaustion" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "acceptedSeen" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "unresolvedEffectCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "legacyUnverified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "providerScope" CHAR(64),
  ADD COLUMN "terminalAt" TIMESTAMPTZ(3),
  ADD COLUMN "historyPrunedThrough" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT notification_grant_state CHECK ("manualGrant" IN ('none', 'reserved', 'spent')),
  ADD CONSTRAINT notification_unresolved_nonnegative CHECK ("unresolvedEffectCount" >= 0);

ALTER TABLE notifications.notification_delivery_attempts
  ADD COLUMN "effectState" VARCHAR(16) NOT NULL DEFAULT 'not_started',
  ADD COLUMN "transportStartedAt" TIMESTAMPTZ(3),
  ADD COLUMN "grantActorId" VARCHAR(64),
  ADD COLUMN "grantCommandId" UUID,
  ADD CONSTRAINT notification_attempt_effect_state CHECK
    ("effectState" IN ('not_started', 'possible', 'proven_none', 'accepted', 'unknown'));

-- Historical attempts cannot establish that no external call happened.
UPDATE notifications.notification_deliveries AS d
SET "legacyUnverified" = true, "unresolvedEffectCount" = 1,
    "acceptedSeen" = (d.status = 'DELIVERED')
WHERE d.channel <> 'in_app' AND (d."attemptCount" > 0
  OR d."providerMessageId" IS NOT NULL OR d."leaseToken" IS NOT NULL
  OR EXISTS (SELECT 1 FROM notifications.notification_delivery_attempts a WHERE a."deliveryId" = d.id));
UPDATE notifications.notification_delivery_attempts AS a SET "effectState" = 'unknown'
FROM notifications.notification_deliveries AS d
WHERE a."deliveryId" = d.id AND d."legacyUnverified";
UPDATE notifications.notification_deliveries
SET "terminalAt" = COALESCE("deliveredAt", "failedAt", "updatedAt")
WHERE status IN ('DELIVERED', 'FAILED', 'SKIPPED', 'CANCELLED');

CREATE INDEX "notification_deliveries_status_channel_createdAt_id_idx"
ON notifications.notification_deliveries (status, channel, "createdAt" DESC, id DESC);
CREATE INDEX "notification_deliveries_unresolvedEffectCount_idx"
ON notifications.notification_deliveries ("unresolvedEffectCount");
CREATE INDEX "notification_deliveries_legacyUnverified_idx"
ON notifications.notification_deliveries ("legacyUnverified");
COMMIT;
