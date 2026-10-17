-- Run through the image's Prisma CLI against the direct migration endpoint.
-- This checks this engine connection, not an administrator's separate session.
DO $$
BEGIN
  IF current_setting('client_connection_check_interval', true) IS DISTINCT FROM '50ms' THEN
    RAISE EXCEPTION 'Migration endpoint must apply client_connection_check_interval=50ms';
  END IF;
END;
$$;
