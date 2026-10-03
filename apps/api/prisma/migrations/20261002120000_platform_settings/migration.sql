ALTER TYPE "core"."AuditTargetType" ADD VALUE 'RUNTIME_SETTING';
CREATE TABLE "core"."platform_settings" (
  "key" VARCHAR(96) PRIMARY KEY,
  "override" JSONB,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("schemaVersion" > 0),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "setting_envelope" CHECK (
    "override" IS NULL OR (
      jsonb_typeof("override") = 'object'
      AND "override" ? 'value'
      AND ("override" - 'value') = '{}'::jsonb
      AND octet_length("override"::text) <= 16384
    )
  ),
  CONSTRAINT "storage_probe_interval" CHECK (
    "key" <> 'storage.probe.intervalSeconds' OR "schemaVersion" <> 1 OR
    "override" IS NULL OR (
      jsonb_typeof("override"->'value') = 'number'
      AND ("override"->>'value')::numeric BETWEEN 30 AND 3600
      AND trunc(("override"->>'value')::numeric) = ("override"->>'value')::numeric
    )
  )
);
INSERT INTO "core"."platform_settings" ("key") VALUES ('storage.probe.intervalSeconds');
