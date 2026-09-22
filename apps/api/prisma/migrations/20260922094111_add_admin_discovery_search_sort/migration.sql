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

-- CreateIndex
CREATE INDEX "organizations_slug_id_idx" ON "core"."organizations"("slug", "id");

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

-- CreateIndex
CREATE INDEX "users_lastLoginAt_id_idx" ON "core"."users"("lastLoginAt", "id");

-- CreateIndex
CREATE INDEX "users_createdAt_id_idx" ON "core"."users"("createdAt", "id");

-- CreateIndex
CREATE INDEX "users_updatedAt_id_idx" ON "core"."users"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "users_name_idx" ON "core"."users" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_email_idx" ON "core"."users" USING GIN ("email" gin_trgm_ops);
