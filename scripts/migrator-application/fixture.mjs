import assert from 'node:assert/strict'
import { writeFile, readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { fixture as databaseFixture } from '../migrator-operations/fixture.mjs'
import { inventory } from '../migrator-operations/history.mjs'
import { setupRoles } from '../migrator-operations/roles.mjs'
import { connect, imageUrl, localUrl } from '../migrator-operations/connection.mjs'
import { root, emit } from '../migrator-operations/context.mjs'
import { label, isolatedContainer } from '../migrator-lifecycle/docker.mjs'
import { command } from './client.mjs'

export async function fixture(f, migrator, previous, current, redis) {
  await databaseFixture(f, migrator)
  for (const [name, image] of Object.entries({ previous, current, redis })) {
    const [artifact] = JSON.parse(await f.docker(['image', 'inspect', image]))
    assert.equal(artifact.Architecture, f.artifact.Architecture)
    f[name] = artifact.Id
  }
  await inventory(f)
  await f.observer.query('CREATE DATABASE amcore')
  f.admin = await connect(f, 'amcore')
  await setupRoles(f, f.admin)
  await f.admin.query(`GRANT CREATE,CONNECT ON DATABASE amcore TO amcore_migrator;
    GRANT CONNECT ON DATABASE amcore TO amcore_runtime;
    GRANT CREATE ON SCHEMA public TO amcore_migrator;
    CREATE SCHEMA core AUTHORIZATION amcore_migrator;
    CREATE SCHEMA notifications AUTHORIZATION amcore_migrator;
    CREATE SCHEMA ai AUTHORIZATION amcore_migrator;`)
  await f.admin.query(f.grants) // Future object ACLs precede fresh migration and application startup.
  f.names = Object.fromEntries(
    Object.entries({
      redis: 'statement_term',
      api: 'statement_int',
      worker: 'transaction_term',
      migrate: 'transaction_int',
    }).map(([key, slot]) => [key, `migrator-lifecycle-${f.run}-${slot}`])
  )
  f.containers.push(...Object.values(f.names))
  f.journal()
  await f.docker([
    'run',
    '-d',
    '--pull=never',
    '--name',
    f.names.redis,
    '--label',
    `${label}=${f.run}`,
    '--network',
    f.network,
    '--network-alias',
    'redis',
    f.redis,
  ])
  await isolatedContainer(f, f.names.redis)
  f.jwt = randomBytes(32).toString('hex')
  f.compose = join(f.directory, 'application-compose.json')
  const source = await readFile(join(root, 'docker-compose.yml'), 'utf8')
  for (const service of ['api', 'worker']) {
    const section = source.slice(source.indexOf(`  ${service}:`)).split(/\n {2}[a-z][\w-]*:/)[0]
    assert.match(section, /migrate:\s*\n\s*condition: service_completed_successfully/)
  }
  emit(f, 'application-artifacts', {
    previous: f.previous,
    current: f.current,
    redis: f.redis,
    migrator: f.artifact.Id,
    architecture: f.artifact.Architecture,
  })
}

export async function configure(f, api, worker, migrationRole = 'amcore_migrator') {
  const runtime = new URL(localUrl(f, 'amcore', 'amcore_runtime'))
  runtime.hostname = 'migration-db'
  runtime.port = '5432'
  runtime.searchParams.set('sslmode', 'verify-full')
  runtime.searchParams.set('sslrootcert', '/run/amcore-migration/ca.crt')
  const shared = {
    restart: 'no',
    labels: { [label]: f.run },
    volumes: [`${f.ssl}/ca.crt:/run/amcore-migration/ca.crt:ro`],
  }
  const app = (image, role, name) => ({
    ...shared,
    image,
    container_name: name,
    stop_grace_period: '30s',
    environment: {
      NODE_ENV: 'development',
      PROCESS_ROLE: role,
      DATABASE_URL: runtime.href,
      REDIS_URL: 'redis://redis:6379',
      JWT_SECRET: f.jwt,
      EMAIL_PROVIDER: 'mock',
      GEOIP_ENABLED: 'false',
      FRONTEND_URL: 'http://localhost:3002',
    },
    depends_on: { migrate: { condition: 'service_completed_successfully' } },
  })
  await writeFile(
    f.compose,
    JSON.stringify({
      services: {
        migrate: {
          ...shared,
          image: f.artifact.Id,
          container_name: f.names.migrate,
          environment: { DATABASE_URL: imageUrl(f, 'amcore', migrationRole) },
        },
        api: app(api, 'web', f.names.api),
        worker: app(worker, 'worker', f.names.worker),
      },
      networks: { default: { external: true, name: f.network } },
    }),
    { mode: 0o600 }
  )
}

export const compose = (f, args, expected = 0) =>
  command(
    f,
    f.names.migrate,
    ['compose', '--project-name', `migration-${f.run}`, '--file', f.compose, ...args],
    expected
  )
