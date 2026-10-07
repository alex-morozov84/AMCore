-- Role-leading lookup for holder counts, holder samples and role-deletion joins.
-- Measured on 200k membership links: a page of custom roles drops from ~8.6 ms (sequential scan) to
-- ~2.2 ms, and the gap grows with the table. This builds the index inside the migration transaction
-- (Prisma migrate), which blocks writes to core.member_roles while it builds; deploy during a quiet
-- window on a very large table, or pre-create it with CREATE INDEX CONCURRENTLY under this exact name.
CREATE INDEX IF NOT EXISTS "member_roles_roleId_memberId_idx" ON "core"."member_roles"("roleId", "memberId");
