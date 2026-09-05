-- AMCore — production DB role separation.
-- See docs/operations/database-role-separation.md for the full guide before
-- running this. This is AMCore's own prescription of standard Postgres
-- least-privilege practice, verified against Postgres's own privilege
-- model — Prisma's docs do not publish this pattern themselves.
--
-- AMCore's Prisma schema uses `multiSchema` (apps/api/prisma/schema.prisma
-- -> datasource `schemas = [...]`) — every model lives in "core",
-- "notifications", or "ai", never in the default "public" schema. The
-- datasource's own `schemas = [...]` array additionally reserves "fitness",
-- "finance", and "subscriptions" for downstream use, but as shipped NO
-- model uses `@@schema(...)` with any of those three — so this script
-- deliberately does NOT grant on them. If your fork adds the first model to
-- one of those (or a new schema name entirely), add a matching
-- "-- SCHEMA:" block below for it BEFORE deploying that migration to
-- production: a forgotten grant here does not fail at migration time, it
-- fails silently until the running app actually queries that schema.
--
-- Run as any admin connection that can create roles (a true Postgres
-- superuser, or a managed provider's admin/master user with `CREATEROLE` —
-- both verified empirically to work with this script unmodified). Replace
-- every <...-password> placeholder with a real, unique secret; replace
-- `amcore` with your actual database name if different.

-- ============================================================================
-- Step 1 — run BEFORE the first `prisma migrate deploy` ever runs against
-- this database. The schemas below don't exist yet on a brand-new database
-- (Prisma's own migrations create them — see Step 2), so only
-- database-level grants belong here.
-- ============================================================================

-- Migrator/owner role: used ONLY by `prisma migrate deploy` (wired via
-- MIGRATION_DATABASE_URL). Owns every schema/table/sequence it creates —
-- Postgres ties ALTER/DROP rights to ownership, not to a separately
-- grantable privilege, so there is no narrower DDL grant to hand out here.
CREATE ROLE amcore_migrator WITH LOGIN PASSWORD '<migrator-password>';
GRANT CREATE, CONNECT ON DATABASE amcore TO amcore_migrator;
-- Required even though amcore_migrator never owns application tables in
-- `public`: Prisma's own bookkeeping table, `_prisma_migrations`, is
-- created in whatever schema MIGRATION_DATABASE_URL's connection defaults
-- to — `public`, per this repo's own `.env.example` — regardless of which
-- schemas your models use. Verified empirically (real `prisma migrate
-- deploy` against all of this repo's migrations): without this grant, the
-- very first migration fails with "permission denied for schema public"
-- before applying anything, because Postgres 15+ no longer grants schema
-- `CREATE` to PUBLIC by default (a security fix in PG15's own release
-- notes) and this is a role-specific grant, not a schema this setup
-- otherwise needs. It does not conflict with the later
-- `REVOKE CREATE ON SCHEMA public FROM PUBLIC` below — that revokes from
-- the PUBLIC pseudo-role, a separate ACL entry from this role-specific
-- grant; verified empirically that migrations still apply correctly after
-- both have run.
GRANT CREATE ON SCHEMA public TO amcore_migrator;

-- Runtime/application role: used by the running api/worker processes
-- (wired via DATABASE_URL). No CREATE, no DDL. Its schema/table grants come
-- in Step 3, once the schemas below actually exist.
CREATE ROLE amcore_runtime WITH LOGIN PASSWORD '<runtime-password>';
GRANT CONNECT ON DATABASE amcore TO amcore_runtime;

-- ============================================================================
-- Step 2 — run `prisma migrate deploy` using MIGRATION_DATABASE_URL wired
-- to amcore_migrator's credentials (see docs/operations/deployment.md ->
-- "Migration contract"). This is what actually creates the "core" /
-- "notifications" / "ai" schemas and every table in them — amcore_migrator
-- becomes their owner automatically because it's the role that created
-- them, exactly like table ownership above.
-- ============================================================================

-- ============================================================================
-- Step 3 — run once, AFTER Step 2 has created the schemas (or immediately,
-- if adopting this on a database that already has them — see "Adopting on
-- an existing database" below).
-- ============================================================================

-- Every GRANT/ALTER DEFAULT PRIVILEGES statement below acts on objects
-- amcore_migrator owns (the schemas and everything in them, from Step 2).
-- A plain `GRANT amcore_migrator TO CURRENT_USER` already defaults to a
-- membership that inherits amcore_migrator's privileges (verified: a bare
-- GRANT with no WITH clause defaults to INHERIT true, SET true), which on
-- its own is enough for both the schema/table GRANTs below and
-- ALTER DEFAULT PRIVILEGES. `SET ROLE amcore_migrator` is used
-- unconditionally anyway — not because of some split between what each
-- statement needs, but because it is the one form that works correctly
-- regardless of how your specific admin connection's membership ended up
-- configured (e.g. an existing membership granted elsewhere with
-- `WITH INHERIT false`, verified to make BOTH kinds of statement fail
-- without SET ROLE, not just one). SET ROLE switches the session's
-- effective identity to amcore_migrator for everything between it and
-- RESET ROLE; the temporary membership is revoked immediately after so
-- this one-time script leaves no standing membership behind. This works
-- whether your admin connection is a true superuser or a managed
-- provider's CREATEROLE-holding admin (verified against both). Separately:
-- omitting `FOR ROLE`/`SET ROLE` entirely and just running
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA core ...` as the admin succeeds with
-- **no error** but silently sets the rule for the admin's own future
-- objects, not amcore_migrator's — a silent no-op, not a loud failure, and
-- the reason this script never relies on "whichever role is currently
-- connected" implicitly. (If you have CREATEROLE, Postgres 16 itself
-- separately leaves you with a permanent, built-in ADMIN-only membership
-- over roles you create — verified this grants no SET ROLE / data access
-- on its own, only the ability to further manage the role; this script
-- neither adds to nor removes that separate, Postgres-native grant.)
-- Everything set up in this block — the grants and the
-- ALTER DEFAULT PRIVILEGES rules — persists after RESET ROLE/REVOKE at the
-- end, verified empirically.
GRANT amcore_migrator TO CURRENT_USER;
SET ROLE amcore_migrator;

-- SCHEMA: core
GRANT USAGE ON SCHEMA core TO amcore_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO amcore_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA core TO amcore_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA core
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO amcore_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA core
  GRANT USAGE, SELECT ON SEQUENCES TO amcore_runtime;

-- SCHEMA: notifications
GRANT USAGE ON SCHEMA notifications TO amcore_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notifications TO amcore_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA notifications TO amcore_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA notifications
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO amcore_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA notifications
  GRANT USAGE, SELECT ON SEQUENCES TO amcore_runtime;

-- SCHEMA: ai
GRANT USAGE ON SCHEMA ai TO amcore_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ai TO amcore_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ai TO amcore_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO amcore_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai
  GRANT USAGE, SELECT ON SEQUENCES TO amcore_runtime;

RESET ROLE;
REVOKE amcore_migrator FROM CURRENT_USER;

-- Postgres 15+ already revokes CREATE on the `public` schema from PUBLIC by
-- default (a security fix in PG15's own release notes) -- kept explicit
-- anyway so a database created before that default changed, or restored
-- from an older dump, still ends up correct. AMCore's own models never use
-- `public` at all (see the multiSchema note at the top), so this is
-- defense-in-depth against something being created there by accident, not
-- a schema this setup actually needs.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ============================================================================
-- Adopting this on an EXISTING database (objects already owned by another
-- role, schemas already exist) — run as a superuser, or as the role that
-- currently owns the objects, BEFORE Step 3 above (Step 2 is irrelevant
-- here — the schemas already exist):
-- ============================================================================
-- REASSIGN OWNED BY <existing_role> TO amcore_migrator;
-- This moves ownership of every existing object across every schema in one
-- statement. It does not set up the ALTER DEFAULT PRIVILEGES rules for
-- objects that don't exist yet — still run Step 3 above afterward so
-- objects created by future migrations keep auto-granting to
-- amcore_runtime.
