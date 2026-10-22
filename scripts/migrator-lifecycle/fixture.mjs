import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url))
export const label = 'io.amcore.migrator-lifecycle.run'

export async function fixture(image) {
  const context = execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim()
  const [configuration] = JSON.parse(
    execFileSync('docker', ['context', 'inspect', context], { encoding: 'utf8' })
  )
  const endpoint = configuration.Endpoints.docker.Host
  assert.ok(endpoint.startsWith('unix://'), 'Lifecycle fixtures require a local Unix Docker engine')
  const docker = (args) =>
    execFileSync('docker', ['--host', endpoint, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    })
  const [artifact] = JSON.parse(docker(['image', 'inspect', image]))
  assert.deepEqual(artifact.Config.Entrypoint, [
    '/usr/bin/tini',
    '-g',
    '--',
    'docker-entrypoint.sh',
  ])
  assert.deepEqual(artifact.Config.Cmd, ['./node_modules/.bin/prisma', 'migrate', 'deploy'])
  assert.equal(artifact.Config.User, 'node')
  const engineArchitecture = docker(['info', '--format', '{{.Architecture}}']).trim()
  const native = { aarch64: 'arm64', x86_64: 'amd64', arm64: 'arm64', amd64: 'amd64' }[
    engineArchitecture
  ]
  assert.equal(artifact.Architecture, native, 'Run the admission on the native image architecture')
  process.env.DOCKER_HOST = endpoint
  delete process.env.DOCKER_CONTEXT
  const { Network } = requireApi('testcontainers')
  const { PostgreSqlContainer } = requireApi('@testcontainers/postgresql')
  const { Client } = requireApi('pg')
  const run = randomUUID()
  const directory = await mkdtemp(join(tmpdir(), 'amcore-migrator-lifecycle-'))
  let network
  let database, observer
  try {
    network = await new Network().start()
    database = await new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('postgres')
      .withUsername('postgres')
      .withPassword(randomBytes(24).toString('hex'))
      .withLabels({ [label]: run })
      .withNetwork(network)
      .withNetworkAliases('migration-db')
      .start()
    observer = new Client({
      connectionString: database.getConnectionUri(),
      query_timeout: 5000,
      connectionTimeoutMillis: 10000,
    })
    await observer.connect()
    const f = {
      run,
      directory,
      network,
      database,
      observer,
      Client,
      docker,
      endpoint,
      artifact,
      containers: [],
    }
    f.journal = () =>
      writeFileSync(
        join(directory, 'resources.json'),
        JSON.stringify({
          run,
          endpoint,
          image: artifact.Id,
          network: network.getName(),
          database: database.getId(),
          containers: f.containers,
        })
      )
    f.journal()
    return f
  } catch (error) {
    try {
      await dispose({ observer, database, network, directory })
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Fixture failed; retained ${directory}`)
    }
    throw error
  }
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
  const body = `${check}\nCREATE TABLE cancellation_probe (id integer PRIMARY KEY);\nSELECT pg_sleep(60);\n`
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

export async function dispose(f) {
  const errors = []
  for (const cleanup of [
    () => f.observer?.end(),
    () => f.database?.stop(),
    () => f.network?.stop(),
  ]) {
    try {
      await cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length)
    throw new AggregateError(errors, `Fixture cleanup incomplete; retained ${f.directory}`)
  await rm(f.directory, { recursive: true, force: true })
}
