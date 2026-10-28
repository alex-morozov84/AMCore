// Reuse the native migrator's isolated TLS/roles/actual-archive fixtures.
import assert from 'node:assert/strict'
import { resources, dispose } from './migrator-lifecycle/resources.mjs'
import { closeClient } from './migrator-lifecycle/safety.mjs'
import { fixture } from './migrator-operations/fixture.mjs'
import { inventory, fresh } from './migrator-operations/history.mjs'
import { setupRoles } from './migrator-operations/roles.mjs'
import { connect, imageUrl } from './migrator-operations/connection.mjs'
import { audit } from './migrator-operations/audit.mjs'
import { backupRestore } from './migrator-operations/recovery.mjs'
import { cli } from './migrator-operations/cli.mjs'
import { databaseProblem, CA } from './load-test/database-check.mjs'

const image = process.argv[2]
assert.ok(image, 'Usage: node scripts/verify-recovery-tls.mjs IMAGE')
const f = await resources()
let admin
try {
  await fixture(f, image)
  await inventory(f)
  await f.observer.query('CREATE DATABASE amcore')
  admin = await connect(f, 'amcore')
  await setupRoles(f, admin)
  await fresh(f, admin)
  const url = new URL(imageUrl(f))
  url.searchParams.set('sslcert', CA)
  const check = async (ca = 'ca.crt', hostname = 'migration-db', expected = 0) => {
    const selected = new URL(url)
    selected.hostname = hostname
    const result = await cli(f, ['db', 'execute', '--file', './migrator-check.sql'], {
      url: selected.href,
      expected,
      mounts: [[`${f.ssl}/${ca}`, CA]],
    })
    if (expected) assert.match(result.text, /TLS|certificate|hostname/i)
  }
  await check()
  await check('wrong.crt', 'migration-db', 1)
  await f.docker(['network', 'disconnect', f.network, f.database.getId()])
  await f.docker([
    'network',
    'connect',
    '--alias',
    'migration-db',
    '--alias',
    'wrong-name',
    f.network,
    f.database.getId(),
  ])
  await check('ca.crt', 'wrong-name', 1)
  const weak = {
    environment: {
      DATABASE_URL: `postgresql://m:x@postgres:5432/amcore?sslmode=verify-full&sslrootcert=${CA}`,
    },
    volumes: [{ type: 'bind', source: f.ssl, target: '/etc/amcore/db-ca', read_only: true }],
  }
  assert.ok(
    databaseProblem('migrate', 'DATABASE_URL', weak, new URL(weak.environment.DATABASE_URL))
  )
  console.log(
    'recovery TLS: native selected CA positive; wrong CA/hostname refused; weak config blocked before dispatch PASS'
  )
  await audit(f, admin)
  await backupRestore(f, admin)
} finally {
  try {
    await closeClient(admin)
  } finally {
    await dispose(f)
  }
}
