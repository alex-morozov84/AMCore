import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { admitImage, internalNetwork, label, owned } from './docker.mjs'
import { checkpoint } from './safety.mjs'

const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url))

export async function fixture(f, image) {
  f.artifact = await admitImage(f, image)
  checkpoint(f)
  process.env.DOCKER_HOST = f.endpoint
  delete process.env.DOCKER_CONTEXT
  const { PostgreSqlContainer } = requireApi('@testcontainers/postgresql')
  const { Client } = requireApi('pg')
  f.Client = Client
  await internalNetwork(f)
  checkpoint(f)
  // Only PostgreSQL joins both networks. Host observer uses its published port;
  // migrator joins the internal network, never the default bridge.
  f.database = await new PostgreSqlContainer('postgres:18-alpine')
    .withName(f.containers[0])
    .withDatabase('postgres')
    .withUsername('postgres')
    .withPassword(randomBytes(24).toString('hex'))
    .withLabels({ [label]: f.run })
    .withAutoRemove(false)
    .withStartupTimeout(60000)
    .start()
  checkpoint(f)
  const database = await owned(f, 'container', f.containers[0])
  assert.equal(database.Id, f.database.getId())
  await f.docker(['network', 'connect', '--alias', 'migration-db', f.network, database.Id])
  checkpoint(f)
  f.observer = new Client({
    connectionString: f.database.getConnectionUri(),
    query_timeout: 5000,
    connectionTimeoutMillis: 10000,
  })
  await f.observer.connect()
  checkpoint(f)
}

export async function migration(f, name, transactional) {
  assert.match(name, /^[a-z_]+$/)
  await f.observer.query(`CREATE DATABASE ${name}`)
  const directory = join(f.directory, name)
  const migrationDirectory = join(directory, 'migrations', '20260101000000_wait')
  await mkdir(migrationDirectory, { recursive: true })
  await writeFile(
    join(directory, 'schema.prisma'),
    'datasource db {\n provider = "postgresql"\n}\nmodel CancellationProbe {\n id Int @id\n @@map("cancellation_probe")\n}\n'
  )
  await writeFile(join(directory, 'migrations', 'migration_lock.toml'), 'provider = "postgresql"\n')
  const check =
    "DO $$ BEGIN IF current_setting('client_connection_check_interval') <> '50ms' THEN RAISE EXCEPTION 'wrong disconnect interval'; END IF; END $$;"
  const body = `${check}\nCREATE TABLE cancellation_probe (id integer PRIMARY KEY);\nINSERT INTO cancellation_probe VALUES (1);\nSELECT pg_sleep(60);\n`
  await writeFile(
    join(migrationDirectory, 'migration.sql'),
    transactional ? `BEGIN;\n${body}COMMIT;\n` : body
  )
  const url = new URL(f.database.getConnectionUri())
  url.hostname = 'migration-db'
  url.port = '5432'
  url.pathname = `/${name}`
  return { name, directory, url: url.href }
}
