-- Drain old invitation writers before deploying this repair.
BEGIN;
WITH repair_clock AS MATERIALIZED (
  SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS value
)
UPDATE core.org_invites SET "revokedAt" = repair_clock.value,
  "updatedAt" = repair_clock.value, "revokedById" = NULL
FROM repair_clock
WHERE "roleId" IS NULL AND "acceptedAt" IS NULL AND "revokedAt" IS NULL;
COMMIT;
