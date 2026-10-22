import assert from 'node:assert/strict'
import { emit } from './context.mjs'
import { writeFile } from 'node:fs/promises'
import { cli } from './cli.mjs'
import { audited } from './audit.mjs'
import { imageUrl } from './connection.mjs'

export async function preflight(f) {
  await cli(f, ['db', 'execute', '--file', './migrator-check.sql'])
  const untrusted = await cli(f, ['db', 'execute', '--file', './migrator-check.sql'], {
    ca: 'wrong.crt',
    expected: 1,
  })
  assert.match(untrusted.text, /TLS|certificate/i, 'Expected certificate refusal')
  const wrong = new URL(imageUrl(f))
  wrong.password = 'migration-deliberately-wrong-fixture-password'
  const authentication = await cli(f, ['db', 'execute', '--file', './migrator-check.sql'], {
    url: wrong.href,
    expected: 1,
  })
  assert.match(
    authentication.text,
    /P1000|Authentication failed/i,
    'Expected authentication refusal'
  )
  await cli(f, [], { url: imageUrl(f, 'amcore', 'amcore_runtime'), expected: 1 })
  emit(f, 'tls-password-and-runtime-fresh-refusal', {
    trustedCA: true,
    untrustedCARefused: true,
    wrongPasswordRefused: true,
    runtimeDeployRefused: true,
  })
}
export async function startupOptions(f, admin) {
  const escaping = [
    String.raw`-c application_name=hello\ world`,
    String.raw`-c application_name=trailing\ `,
    String.raw`-c application_name=back\\slash`,
  ]
  for (const options of escaping)
    await audited(
      f,
      admin,
      'escaped-startup-option',
      ['db', 'execute', '--file', './migrator-check.sql'],
      { url: imageUrl(f, 'amcore', 'amcore_migrator', { options }) }
    )
  await cli(f, ['db', 'execute', '--file', './migrator-check.sql'], {
    url: imageUrl(f, 'amcore', 'amcore_migrator', {
      options: '-c client_connection_check_interval=0',
    }),
    expected: 1,
  })
  const duplicate = new URL(imageUrl(f))
  duplicate.searchParams.append('options', '-c a=b')
  duplicate.searchParams.append('options', '-c b=c')
  await cli(f, ['db', 'execute', '--file', './migrator-check.sql'], {
    url: duplicate.href,
    expected: 1,
  })
  await cli(f, ['db', 'execute', '--file', './migrator-check.sql'], {
    url: imageUrl(f, 'amcore', 'amcore_migrator', { pgbouncer: 'true' }),
    expected: 1,
  })
  await audited(
    f,
    admin,
    'selected-url-priority',
    ['db', 'execute', '--file', './migrator-check.sql'],
    {
      url: 'postgresql://placeholder:placeholder@foreign.invalid/placeholder',
      env: { E2E_DATABASE_URL: imageUrl(f) },
    }
  )
  const slow = `${f.directory}/connected-slow.sql`
  await writeFile(
    slow,
    `DO $$ BEGIN IF current_setting('client_connection_check_interval')<>'50ms' THEN RAISE EXCEPTION 'wrong interval'; END IF; END $$; SELECT pg_sleep(8);`
  )
  await audited(
    f,
    admin,
    'connected-long-sql-not-statement-timeout',
    ['db', 'execute', '--file', '/run/amcore-migration/slow.sql'],
    { mounts: [[slow, '/run/amcore-migration/slow.sql']] }
  )
  for (const mode of ['ignored', 'denied']) {
    await admin.query('UPDATE verifier.mode SET mode=$1', [mode])
    await cli(f, ['db', 'execute', '--file', './migrator-check.sql'], { expected: 1 })
    emit(f, `preflight-${mode}-capability-refusal`, {
      simulatedProvider: true,
      actualCLIFailure: true,
    })
  }
  await admin.query(`UPDATE verifier.mode SET mode='normal'`)
  await audited(f, admin, 'preflight-restored-normal', [
    'db',
    'execute',
    '--file',
    './migrator-check.sql',
  ])
  assert.equal(
    (
      await admin.query(
        `SELECT count(*)::int AS n FROM pg_db_role_setting WHERE array_to_string(setconfig,',') LIKE '%client_connection_check_interval%'`
      )
    ).rows[0].n,
    0
  )
}
