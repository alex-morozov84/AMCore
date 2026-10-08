-- Role-leading lookup: holder counts and samples read member_roles by role, and deleting a role
-- cascades to its links through the roleId foreign key; the existing unique index starts with
-- memberId and cannot serve either lookup.
-- A plain CREATE INDEX blocks writes to core.member_roles while it builds. On a large installation
-- pre-create it concurrently under this exact name and verify it before deploying (see the
-- upgrade note in the role definitions guide); IF NOT EXISTS keeps any index of that name, so the
-- pre-created one must be valid and match this definition.
CREATE INDEX IF NOT EXISTS "member_roles_roleId_memberId_idx" ON "core"."member_roles"("roleId", "memberId");
