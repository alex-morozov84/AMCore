import assert from 'node:assert/strict'
import { emit } from './context.mjs'
import { connect, withConnection, password } from './connection.mjs'
import { closeClient } from '../migrator-lifecycle/safety.mjs'

export async function createDatabase(f, name) {
  assert.match(name, /^[a-z_]+$/)
  await f.observer.query(`CREATE DATABASE ${name}`)
  const c = await connect(f, name)
  try {
    await c.query(
      `GRANT CREATE,CONNECT ON DATABASE ${name} TO amcore_migrator; GRANT CONNECT ON DATABASE ${name} TO amcore_runtime; GRANT CREATE ON SCHEMA public TO amcore_migrator;`
    )
  } catch (error) {
    try {
      await closeClient(c)
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Database setup/cleanup failed')
    }
    throw error
  }
  return c
}
async function denySql(client, sql) {
  await assert.rejects(client.query(sql), (e) => e.code === '42501')
}
export async function runtimeProof(f, database, probe = 'migration_probe') {
  assert.match(probe, /^migration_[a-z_]+$/)
  await withConnection(f, database, 'amcore_runtime', async (c) => {
    await c.query(
      `INSERT INTO core.users(id,email,"emailCanonical","updatedAt") VALUES ('migration-user','fixture@example.invalid','fixture@example.invalid',CURRENT_TIMESTAMP)`
    )
    assert.equal(
      (
        await c.query(
          `UPDATE core.users SET name='runtime-updated' WHERE id='migration-user' RETURNING name`
        )
      ).rows[0].name,
      'runtime-updated'
    )
    assert.equal((await c.query(`DELETE FROM core.users WHERE id='migration-user'`)).rowCount, 1)
    const value = (
      await c.query(`INSERT INTO core.${probe}(payload) VALUES ('runtime') RETURNING id`)
    ).rows[0].id
    assert.ok(value > 0)
    for (const sql of [
      'CREATE TABLE core.forbidden(id int)',
      `ALTER TABLE core.${probe} ADD COLUMN forbidden int`,
      `DROP TABLE core.${probe}`,
      `TRUNCATE core.${probe}`,
      'SET ROLE amcore_migrator',
    ])
      await denySql(c, sql)
    assert.equal(
      (await c.query('SHOW client_connection_check_interval')).rows[0]
        .client_connection_check_interval,
      '0'
    )
  })
  emit(f, `runtime-dml-denials-${database}`, {
    denied: ['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'SET ROLE'],
    roleDefault: '0',
    probe,
  })
}

export async function ownership(f, client, phase) {
  const { rows } = await client.query(`SELECT nspname,pg_get_userbyid(nspowner) AS owner
    FROM pg_namespace WHERE nspname IN ('core','notifications','ai') ORDER BY nspname`)
  assert.deepEqual(
    rows,
    ['ai', 'core', 'notifications'].map((nspname) => ({ nspname, owner: 'amcore_migrator' }))
  )
  const counts = (
    await client.query(`SELECT count(*)::int AS objects,
    count(*) FILTER (WHERE pg_get_userbyid(c.relowner)<>'amcore_migrator')::int AS wrong
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('core','notifications','ai') AND c.relkind IN ('r','p','S')`)
  ).rows[0]
  assert.ok(counts.objects > 0)
  assert.equal(counts.wrong, 0)
  emit(f, `ownership-${phase}`, { schemas: rows.length, ...counts })
}

export async function setupRoles(f, admin) {
  await admin.query(f.rolesTemplate.slice(0, f.rolesTemplate.indexOf('-- Step 2:')))
  for (const role of Object.keys(f.roles)) {
    await password(f, role)
    await assert.rejects(
      connect(f, 'amcore', role),
      (e) => e.code === '28000' && /not permitted to log in/.test(e.message)
    )
    await admin.query(`ALTER ROLE ${role} LOGIN`)
  }
  const attrs = (
    await admin.query(
      `SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname IN ('amcore_migrator','amcore_runtime') ORDER BY rolname`
    )
  ).rows
  assert.equal(attrs.length, 2)
  assert.ok(
    attrs.every((r) => !r.rolsuper && !r.rolcreatedb && !r.rolcreaterole && !r.rolbypassrls)
  )
  emit(f, 'roles-nologin-and-least-privilege', {
    roles: attrs.map((r) => r.rolname),
    noPrivilegedAttributes: true,
  })
}
