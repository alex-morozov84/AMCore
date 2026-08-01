-- AMCore's base locale is English; `ru` ships as a fully translated second
-- locale. This moves the new-row defaults off the previous RU-centric values
-- (`ru` / `Europe/Moscow`) so a fresh install is locale-neutral.
--
-- NO BACKFILL, DELIBERATELY. `SET DEFAULT` affects future inserts only; every
-- existing row keeps its stored `locale`/`timezone`. A stored value cannot be
-- told apart from a preference the user actually chose, so rewriting it would
-- silently override real preferences. Downstream forks with existing users:
-- if you want the new defaults applied to users who never chose explicitly,
-- that is a separate, opt-in data migration you must write yourself.

-- AlterTable
ALTER TABLE "core"."users" ALTER COLUMN "locale" SET DEFAULT 'en',
ALTER COLUMN "timezone" SET DEFAULT 'UTC';
