-- AMCore production database roles.
-- Review docs/operations/database-role-separation.md before running this
-- manual template. Replace `amcore` if the target database has another name.
-- Run as an administrator with CREATEROLE. The separate pg_monitor grant needs
-- the stronger capability documented in
-- docs/operations/pg-stat-statements-observer-role.md.
--
-- AMCore models currently use core, notifications, and ai. If a fork adds a
-- model to another schema, add the matching grants and default privileges
-- before deploying that migration.

-- Step 1: run before the first `prisma migrate deploy`. Roles stay NOLOGIN
-- until an operator assigns strong, unique passwords interactively. Never put
-- a password in SQL; see docs/operations/pg-stat-statements-security.md.

-- Migration owner, used only through MIGRATION_DATABASE_URL.
CREATE ROLE amcore_migrator WITH NOLOGIN;
GRANT CREATE, CONNECT ON DATABASE amcore TO amcore_migrator;
-- Prisma creates _prisma_migrations in the connection's default public schema.
GRANT CREATE ON SCHEMA public TO amcore_migrator;

-- Runtime role for API and worker processes, used through DATABASE_URL.
CREATE ROLE amcore_runtime WITH NOLOGIN;
GRANT CONNECT ON DATABASE amcore TO amcore_runtime;

-- In interactive psql, while both roles are still NOLOGIN:
--   \password amcore_migrator
--   \password amcore_runtime
-- Only after both passwords are set:
--   ALTER ROLE amcore_migrator LOGIN;
--   ALTER ROLE amcore_runtime LOGIN;

-- Step 2: run `prisma migrate deploy` as amcore_migrator. The migrations
-- create the schemas and objects below, owned by that role.

-- Step 3: run after Step 2, or immediately when adopting existing schemas.
-- Temporary membership plus SET ROLE ensures default privileges are recorded
-- for objects amcore_migrator will create, not for the connected administrator.
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

-- Keep this explicit for databases created before PostgreSQL 15 or restored
-- from older dumps; AMCore does not use public for application models.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Existing database only: before Step 3, run as the current object owner or a
-- superuser, replacing the placeholder. Step 3 is still required afterward.
--   REASSIGN OWNED BY <existing-role> TO amcore_migrator;

-- Optional query-statistics observer. This grants no application-table access.
CREATE ROLE amcore_observer WITH NOLOGIN;
GRANT CONNECT ON DATABASE amcore TO amcore_observer;
-- In interactive psql:
--   \password amcore_observer
--   ALTER ROLE amcore_observer LOGIN;
-- Then grant pg_monitor from a connection authorized to delegate it:
--   GRANT pg_monitor TO amcore_observer;
