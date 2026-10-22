import assert from 'node:assert/strict'
import { emit } from './context.mjs'
import { readdir, readFile, cp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { root } from './context.mjs'
import { cli } from './cli.mjs'
import { imageUrl, withConnection, usingConnection } from './connection.mjs'
import { createDatabase, runtimeProof } from './roles.mjs'

export async function ledger(f, client, names) {
  const { rows } = await client.query(
    'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name,started_at'
  )
  assert.deepEqual(
    rows.map((x) => x.migration_name),
    names
  )
  assert.ok(rows.every((x) => x.finished_at !== null && x.rolled_back_at === null))
  for (const row of rows) assert.equal(row.checksum, f.hashes.get(row.migration_name))
  return rows.length
}
export async function inventory(f) {
  f.migrations = (await readdir(`${root}/apps/api/prisma/migrations`, { withFileTypes: true }))
    .filter((x) => x.isDirectory())
    .map((x) => x.name)
    .sort()
  f.hashes = new Map(
    await Promise.all(
      f.migrations.map(async (n) => [
        n,
        createHash('sha256')
          .update(await readFile(`${root}/apps/api/prisma/migrations/${n}/migration.sql`))
          .digest('hex'),
      ])
    )
  )
  f.rolesTemplate = await readFile(`${root}/docker/postgres/setup-roles.sql`, 'utf8')
  assert.ok(f.migrations.length > 1, 'Expected migration history for upgrade fixture')
  assert.ok(f.rolesTemplate.includes('GRANT amcore_migrator TO CURRENT_USER;'))
  assert.ok(f.rolesTemplate.includes('REVOKE CREATE ON SCHEMA public FROM PUBLIC;'))
  emit(f, 'source-migration-inventory', {
    count: f.migrations.length,
    first: f.migrations[0],
    last: f.migrations.at(-1),
    orderedChecksumsSha256: createHash('sha256')
      .update(JSON.stringify([...f.hashes]))
      .digest('hex'),
  })
  f.grants = f.rolesTemplate.slice(
    f.rolesTemplate.indexOf('GRANT amcore_migrator TO CURRENT_USER;'),
    f.rolesTemplate.indexOf('REVOKE CREATE ON SCHEMA public FROM PUBLIC;') +
      'REVOKE CREATE ON SCHEMA public FROM PUBLIC;'.length
  )
}
export async function fresh(f, admin) {
  await cli(f)
  await ledger(f, admin, f.migrations)
  await admin.query(f.grants)
  const owners = (
    await admin.query(
      `SELECT count(*)::int AS wrong FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname IN ('core','notifications','ai') AND c.relkind IN ('r','S')) AND pg_get_userbyid(c.relowner)<>'amcore_migrator'`
    )
  ).rows[0].wrong
  assert.equal(owners, 0)
  await withConnection(f, 'amcore', 'amcore_migrator', (c) =>
    c.query('CREATE TABLE core.migration_probe(id serial PRIMARY KEY,payload text NOT NULL)')
  )
  await runtimeProof(f, 'amcore')
  emit(f, 'fresh-current-history-and-ownership', {
    migrations: f.migrations.length,
    checksumMatches: true,
    wrongOwners: owners,
  })
}
export async function upgrade(f) {
  const upgrade = await createDatabase(f, 'amcore_upgrade')
  await usingConnection(upgrade, async (upgrade) => {
    const oldSchema = `${f.directory}/previous-prisma`
    await cp(`${root}/apps/api/prisma`, oldSchema, { recursive: true })
    await rm(`${oldSchema}/migrations/${f.migrations.at(-1)}`, { recursive: true })
    await cli(f, [], { url: imageUrl(f, 'amcore_upgrade'), schema: oldSchema })
    await ledger(f, upgrade, f.migrations.slice(0, -1))
    await upgrade.query(f.grants)
    await withConnection(f, 'amcore_upgrade', 'amcore_runtime', async (c) => {
      await c.query(
        `INSERT INTO core.users(id,email,"emailCanonical","updatedAt") VALUES ('upgrade-user','upgrade@example.invalid','upgrade@example.invalid',CURRENT_TIMESTAMP)`
      )
      await c.query(
        `INSERT INTO core.password_reset_tokens(id,"userId","tokenHash","expiresAt") VALUES ('upgrade-token','upgrade-user','fixture-hash-never-real',CURRENT_TIMESTAMP+INTERVAL '1 hour')`
      )
    })
    await cli(f, [], { url: imageUrl(f, 'amcore_upgrade') })
    await ledger(f, upgrade, f.migrations)
    const preserved = (
      await upgrade.query(
        `SELECT "frontendDestination","placementFingerprint" FROM core.password_reset_tokens WHERE id='upgrade-token'`
      )
    ).rows[0]
    assert.deepEqual(preserved, { frontendDestination: 'site', placementFingerprint: null })
    assert.equal(
      (await upgrade.query(`SELECT count(*)::int AS n FROM core.users WHERE id='upgrade-user'`))
        .rows[0].n,
      1
    )
    await withConnection(f, 'amcore_upgrade', 'amcore_migrator', (c) =>
      c.query('CREATE TABLE core.migration_probe(id serial PRIMARY KEY,payload text NOT NULL)')
    )
    await runtimeProof(f, 'amcore_upgrade')
    emit(f, 'upgrade-with-data', {
      from: f.migrations.length - 1,
      to: f.migrations.length,
      dataPreserved: true,
      newDefaultVerified: true,
    })
  })
}
