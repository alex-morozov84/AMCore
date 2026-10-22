import assert from 'node:assert/strict'
import { emit } from './context.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { cli } from './cli.mjs'
import { audit, audited } from './audit.mjs'
import { imageUrl, withConnection, usingConnection } from './connection.mjs'
import { createDatabase, runtimeProof } from './roles.mjs'
import { ledger } from './history.mjs'

export async function partialRecovery(f) {
  const recovery = await createDatabase(f, 'amcore_recovery')
  await usingConnection(recovery, async (recovery) => {
    const schema = `${f.directory}/recovery-prisma`,
      name = '20260101000000_partial'
    await mkdir(`${schema}/migrations/${name}`, { recursive: true })
    await writeFile(
      `${schema}/schema.prisma`,
      'datasource db {\n provider = "postgresql"\n schemas = ["core"]\n}\nmodel PartialProbe {\n id Int @id\n @@map("migration_partial")\n @@schema("core")\n}\n'
    )
    await writeFile(`${schema}/migrations/migration_lock.toml`, 'provider = "postgresql"\n')
    const sql = `CREATE SCHEMA IF NOT EXISTS core; BEGIN; CREATE TABLE core.migration_partial(id int PRIMARY KEY); COMMIT; BEGIN; INSERT INTO core.migration_partial VALUES (1); COMMIT;`
    await writeFile(`${schema}/migrations/${name}/migration.sql`, `${sql} SELECT 1/0;`)
    const failed = await cli(f, [], { url: imageUrl(f, 'amcore_recovery'), schema, expected: 1 })
    assert.match(failed.text, /P3018/)
    assert.equal(
      (await recovery.query('SELECT count(*)::int AS n FROM core.migration_partial')).rows[0].n,
      1
    )
    const blocked = await cli(f, [], { url: imageUrl(f, 'amcore_recovery'), schema, expected: 1 })
    assert.match(blocked.text, /P3009/)
    await audit(f, recovery)
    await audited(f, recovery, 'failed-history-status', ['migrate', 'status'], {
      url: imageUrl(f, 'amcore_recovery'),
      schema,
      expected: 1,
    })
    await audited(
      f,
      recovery,
      'resolve-rolled-back',
      ['migrate', 'resolve', '--rolled-back', name],
      { url: imageUrl(f, 'amcore_recovery'), schema }
    )
    assert.equal(
      (await recovery.query('SELECT count(*)::int AS n FROM core.migration_partial')).rows[0].n,
      1,
      'Resolve must not undo committed SQL'
    )
    await withConnection(f, 'amcore_recovery', 'amcore_migrator', (c) =>
      c.query('DROP TABLE core.migration_partial')
    )
    await writeFile(`${schema}/migrations/${name}/migration.sql`, sql)
    await audited(f, recovery, 'retry-after-explicit-reconciliation', [], {
      url: imageUrl(f, 'amcore_recovery'),
      schema,
    })
    await audited(f, recovery, 'recovery-final-status', ['migrate', 'status'], {
      url: imageUrl(f, 'amcore_recovery'),
      schema,
    })
    const rows = (
      await recovery.query(
        'SELECT finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY started_at'
      )
    ).rows
    assert.equal(rows.length, 2)
    assert.equal(rows.filter((x) => x.finished_at).length, 1)
    assert.equal(rows.filter((x) => x.rolled_back_at).length, 1)
    emit(f, 'partial-commit-and-recovery', {
      partialObjectAndRow: true,
      redeployBlocked: true,
      resolveDidNotUndoSQL: true,
      finished: 1,
      rolledBack: 1,
    })
  })
}
export async function backupRestore(f, admin) {
  await admin.query('DROP EVENT TRIGGER verifier_login; DROP SCHEMA verifier CASCADE')
  await withConnection(f, 'amcore', 'amcore_runtime', (c) =>
    c.query(
      `INSERT INTO core.users(id,email,"emailCanonical","updatedAt") VALUES ('backup-user','backup@example.invalid','backup@example.invalid',CURRENT_TIMESTAMP)`
    )
  )
  await f.docker([
    'exec',
    f.database.getId(),
    'pg_dump',
    '-U',
    'postgres',
    '--format=custom',
    '--file=/tmp/migration.dump',
    'amcore',
  ])
  const restored = await createDatabase(f, 'amcore_restore')
  await usingConnection(restored, async (restored) => {
    await f.docker([
      'exec',
      f.database.getId(),
      'pg_restore',
      '-U',
      'postgres',
      '--exit-on-error',
      '--dbname=amcore_restore',
      '/tmp/migration.dump',
    ])
    await restored.query(f.grants)
    await ledger(f, restored, f.migrations)
    await runtimeProof(f, 'amcore_restore')
    assert.equal(
      (await restored.query(`SELECT count(*)::int AS n FROM core.users WHERE id='backup-user'`))
        .rows[0].n,
      1
    )
    assert.equal(
      (
        await restored.query(
          `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('core','notifications','ai') AND c.relkind IN ('r','S') AND pg_get_userbyid(c.relowner)<>'amcore_migrator'`
        )
      ).rows[0].n,
      0
    )
    emit(f, 'backup-restore-owner-acl-data-ledger', {
      migrations: f.migrations.length,
      ownerPreserved: true,
      aclReapplied: true,
      dataPreserved: true,
    })
  })
}
