-- Add canonical email identity key while preserving display/contact email.
ALTER TABLE "core"."users" ADD COLUMN "emailCanonical" TEXT;

UPDATE "core"."users"
SET "emailCanonical" = LOWER(TRIM("email"));

DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO duplicate_count
  FROM (
    SELECT "emailCanonical"
    FROM "core"."users"
    GROUP BY "emailCanonical"
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Cannot add unique emailCanonical: duplicate canonical emails exist. Resolve duplicates manually before running this migration.';
  END IF;
END $$;

ALTER TABLE "core"."users" ALTER COLUMN "emailCanonical" SET NOT NULL;

DROP INDEX "core"."users_email_key";

CREATE UNIQUE INDEX "users_emailCanonical_key" ON "core"."users"("emailCanonical");
