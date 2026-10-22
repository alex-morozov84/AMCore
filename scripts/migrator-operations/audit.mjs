import assert from 'node:assert/strict'
import { cli } from './cli.mjs'
import { emit } from './context.mjs'
export async function audit(f, client) {
  await client.query(`CREATE SCHEMA verifier;
 CREATE TABLE verifier.mode (mode text NOT NULL); INSERT INTO verifier.mode VALUES ('normal');
 CREATE TABLE verifier.connections (id bigserial PRIMARY KEY,pid integer,role_name text,interval_value text,tls boolean);
 CREATE FUNCTION verifier.audit_login() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,verifier AS $$
 DECLARE mode_value text;
 BEGIN
 IF session_user IN ('amcore_migrator','amcore_runtime') THEN
 SELECT mode INTO mode_value FROM verifier.mode;
 IF mode_value='ignored' THEN PERFORM set_config('client_connection_check_interval','0',false); END IF;
 IF mode_value='denied' THEN RAISE EXCEPTION 'fixture denied startup capability'; END IF;
 INSERT INTO verifier.connections(pid,role_name,interval_value,tls) VALUES(pg_backend_pid(),session_user,current_setting('client_connection_check_interval'),(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()));
 END IF; END $$;
 CREATE EVENT TRIGGER verifier_login ON login EXECUTE FUNCTION verifier.audit_login();`)
}
export async function audited(f, client, check, args, options = {}) {
  const before = Number(
    (await client.query('SELECT COALESCE(max(id),0)::int AS id FROM verifier.connections')).rows[0]
      .id
  )
  const result = await cli(f, args, options)
  const { rows } = await client.query(
    'SELECT interval_value,tls FROM verifier.connections WHERE id>$1 AND role_name=$2',
    [before, 'amcore_migrator']
  )
  assert.ok(rows.length > 0, 'Successful CLI lacked audited connection')
  assert.ok(
    rows.every((r) => r.interval_value === '50ms' && r.tls === true),
    'CLI failed actual TLS/50ms audit'
  )
  emit(f, check, {
    verdict: 'PASS',
    connections: rows.length,
    interval: '50ms',
    tls: true,
    exit: result.code,
  })
  return result
}
