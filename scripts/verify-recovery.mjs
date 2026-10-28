// Real archive/script proof using the existing labelled local resource journal.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { resources, dispose, removeContainer } from './migrator-lifecycle/resources.mjs'
import { fileProof } from './recovery-file-proof.mjs'
import { label } from './migrator-lifecycle/docker.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

assert.ok(
  process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--files-only'),
  'Usage: node scripts/verify-recovery.mjs [--files-only]'
)
const filesOnly = process.argv[2] === '--files-only'
const root = resolve(import.meta.dirname, '..')
const f = await resources()
const name = f.containers[0]
const backups = join(f.directory, 'backups')
const hash = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
const mount = (source, target) => ['--mount', `type=bind,src=${source},dst=${target},readonly`]
const execute = promisify(execFile)
const run = async (args, expected = true) => {
  let result
  try {
    result = await execute('docker', ['--host', f.endpoint, ...args], {
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch (error) {
    // Exit1 is a script refusal; psql ON_ERROR_STOP uses3. A Docker transport/image failure (125) is no verdict.
    if (expected || ![1, 3].includes(error.code) || error.killed)
      throw new Error('Recovery command did not complete as expected', { cause: error })
    return error.stdout
  }
  assert.ok(expected, 'Expected command refusal')
  return result.stdout
}
const container = (args) => [
  'run',
  '--name',
  name,
  '--label',
  `${label}=${f.run}`,
  '--network',
  'none',
  '--tmpfs',
  '/var/lib/postgresql',
  ...args,
]
try {
  if (!filesOnly) {
    await mkdir(backups)
    await run(container(['-d', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:18-alpine']))
    await run([
      'exec',
      name,
      'sh',
      '-c',
      'until [ "$(cat /proc/1/comm)" = postgres ] && pg_isready -U postgres; do sleep 0.2; done',
    ])
    const sql = `CREATE SCHEMA core;
    CREATE TABLE core.users(id text PRIMARY KEY); INSERT INTO core.users VALUES ('known');
    CREATE TABLE core.organizations(id text); CREATE TABLE core.org_members(id text);
    CREATE TABLE public._prisma_migrations(migration_name text,checksum text,finished_at timestamptz,rolled_back_at timestamptz);
    INSERT INTO public._prisma_migrations VALUES ('20261027000000_fixture',repeat('a',64),now(),NULL);`
    await run(['exec', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql])
    for (const [file, args] of [
      ['valid.dump', []],
      ['ledger.dump', ['--schema=public']],
    ]) {
      await run(['exec', name, 'pg_dump', '-U', 'postgres', '-Fc', ...args, '-f', `/tmp/${file}`])
      await run(['cp', `${name}:/tmp/${file}`, join(backups, file)])
    }
    for (const [file, change] of [
      ['unresolved.dump', 'UPDATE public._prisma_migrations SET finished_at=NULL'],
      ['null-ledger.dump', 'UPDATE public._prisma_migrations SET migration_name=NULL'],
      ['missing-table.dump', 'DROP TABLE core.org_members'],
    ]) {
      await run([
        'exec',
        name,
        'psql',
        '-U',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        "UPDATE public._prisma_migrations SET finished_at=now(),migration_name='20261027000000_fixture';" +
          change,
      ])
      await run(['exec', name, 'pg_dump', '-U', 'postgres', '-Fc', '-f', `/tmp/${file}`])
      await run(['cp', `${name}:/tmp/${file}`, join(backups, file)])
    }
    await removeContainer(f, name)
    await writeFile(join(backups, 'bad.dump'), 'broken')
    await writeFile(join(backups, 'empty.sql'), '')
    await writeFile(
      join(backups, 'known.sql'),
      `DO $$ BEGIN IF NOT EXISTS(SELECT FROM core.users WHERE id='known') THEN RAISE EXCEPTION 'missing row'; END IF; END $$;`
    )
    await writeFile(
      join(backups, 'wrong.sql'),
      `DO $$ BEGIN IF NOT EXISTS(SELECT FROM core.users WHERE id='wrong') THEN RAISE EXCEPTION 'missing row'; END IF; END $$;`
    )
    await chmod(join(backups, 'valid.dump'), 0o600)
    await chmod(join(backups, 'known.sql'), 0o600)
    await writeFile(
      join(backups, 'zero.sql'),
      "DO $$ BEGIN IF EXISTS(SELECT FROM core.organizations) THEN RAISE EXCEPTION 'expected zero'; END IF; END $$;"
    )
    await writeFile(join(backups, 'write.sql'), "INSERT INTO core.users VALUES ('forbidden');")
    await writeFile(
      join(backups, 'checksum.sql'),
      "DO $$ BEGIN IF EXISTS(SELECT FROM public._prisma_migrations WHERE checksum<>repeat('b',64)) THEN RAISE EXCEPTION 'wrong checksum'; END IF; END $$;"
    )
    const before = await hash(join(backups, 'valid.dump'))
    for (const [file, assertion, expected] of [
      ['valid.dump', 'known.sql', true],
      ['valid.dump', undefined, true],
      ['ledger.dump', undefined, false],
      ['unresolved.dump', undefined, false],
      ['null-ledger.dump', undefined, false],
      ['missing-table.dump', undefined, false],
      ['valid.dump', 'zero.sql', true],
      ['valid.dump', 'write.sql', false],
      ['valid.dump', 'checksum.sql', false],
      ['bad.dump', undefined, false],
      ['missing.dump', undefined, false],
      ['valid.dump', 'wrong.sql', false],
      ['valid.dump', 'empty.sql', false],
      ['valid.dump', 'missing.sql', false],
    ]) {
      await run(
        container([
          '--entrypoint',
          'sh',
          ...mount(backups, '/backups'),
          ...mount(join(root, 'docker/postgres'), '/scripts'),
          'postgres:18-alpine',
          '/scripts/restore-drill.sh',
          file,
          ...(assertion ? [`/backups/${assertion}`] : []),
        ]),
        expected
      )
      await removeContainer(f, name)
      console.log(`recovery: ${file}/${assertion ?? 'structural'} expected=${expected} PASS`)
    }
    assert.equal(await hash(join(backups, 'valid.dump')), before)
    console.log('recovery: read-only source unchanged PASS')
  }
  await fileProof({ f, root, container, run })
} finally {
  await dispose(f)
}
