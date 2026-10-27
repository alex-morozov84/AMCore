-- Forks may replace this mounted baseline deliberately for their own schema.
DO $$
DECLARE
  relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY[
    'core.users', 'core.organizations', 'core.org_members', 'public._prisma_migrations'
  ] LOOP
    IF NOT EXISTS (
      SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname || '.' || c.relname = relation AND c.relkind IN ('r', 'p')
    ) THEN
      RAISE EXCEPTION 'Required application table missing: %', relation;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT FROM public._prisma_migrations WHERE finished_at IS NOT NULL)
    OR EXISTS (
      SELECT FROM public._prisma_migrations
      WHERE (finished_at IS NULL AND rolled_back_at IS NULL)
        OR migration_name IS NULL OR checksum IS NULL
        OR migration_name !~ '^[0-9]{14}_[a-z0-9_]+$'
        OR checksum !~ '^[a-f0-9]{64}$'
    ) THEN
    RAISE EXCEPTION 'Migration history absent, unresolved or malformed';
  END IF;
END $$;
