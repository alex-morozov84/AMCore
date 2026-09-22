-- Required by the GIN trigram indexes below (case-insensitive literal-contains
-- admin discovery search, ADR-082). Trusted since PG13: installable by any role
-- with CREATE on the target database, no superuser grant needed. Installed into
-- `public` explicitly — the schema `amcore_migrator` is already granted CREATE
-- on (`docker/postgres/setup-roles.sql`), same as this connection's own
-- `_prisma_migrations` bookkeeping table, rather than left to an ambient
-- search_path.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- CreateIndex
CREATE INDEX "organizations_name_id_idx" ON "core"."organizations"("name", "id");

-- No composite (slug, id) index: `slug` is already UNIQUE, so no two rows
-- can ever tie on it and an id tie-breaker is structurally impossible to
-- need. Verified via EXPLAIN: the existing unique index alone already
-- serves "ORDER BY slug, id" in both directions through a cheap Incremental
-- Sort with a single presorted group.

-- CreateIndex
CREATE INDEX "organizations_createdAt_id_idx" ON "core"."organizations"("createdAt", "id");

-- CreateIndex
CREATE INDEX "organizations_updatedAt_id_idx" ON "core"."organizations"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "organizations_name_idx" ON "core"."organizations" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "organizations_slug_idx" ON "core"."organizations" USING GIN ("slug" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_name_id_idx" ON "core"."users"("name", "id");

-- CreateIndex
CREATE INDEX "users_email_id_idx" ON "core"."users"("email", "id");

-- CreateIndex (raw SQL, not Prisma schema DSL — see the comment above the
-- User model in user.prisma). `AdminService.resolveUserOrderBy`'s default
-- for `lastLoginAt` is `DESC NULLS LAST`; a plain ascending index can only
-- provide `DESC NULLS FIRST` on a backward scan, which Postgres correctly
-- refuses to use for this query (verified via EXPLAIN: falls back to a full
-- Seq Scan + Sort without this exact NULLS clause). Prisma 7.10.0's
-- `nulls:` field-index modifier validates but is silently dropped from the
-- generated SQL — also verified, not assumed.
CREATE INDEX "users_lastLoginAt_id_idx" ON "core"."users"("lastLoginAt" DESC NULLS LAST, "id" DESC);

-- CreateIndex
CREATE INDEX "users_createdAt_id_idx" ON "core"."users"("createdAt", "id");

-- CreateIndex
CREATE INDEX "users_updatedAt_id_idx" ON "core"."users"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "users_name_idx" ON "core"."users" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_email_idx" ON "core"."users" USING GIN ("email" gin_trgm_ops);
