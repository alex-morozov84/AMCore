// Render actual Compose files without starting services or touching a database.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checkOverride } from './load-test/override-check.mjs'
import { checkTarget } from './load-test/target-check.mjs'
import { CA } from './load-test/database-check.mjs'

const directory = await mkdtemp(join(tmpdir(), 'amcore-load-config-'))
const project = 'amcore-loadtest-configproof'
const files = [
  'docker-compose.yml',
  'docker/compose/supervise.yml',
  'docker/compose/postgres-tls.yml',
  'docker/compose/web.yml',
  'docker/compose/bff-relay.yml',
  'docker/compose/load-test.yml',
]
try {
  await mkdir(join(directory, 'ca'))
  const envFile = join(directory, 'compose.env')
  const pg = `postgresql://fixture:fixture@postgres:5432/amcore?sslmode=verify-full&sslrootcert=${CA}`
  await writeFile(
    envFile,
    Object.entries({
      COMPOSE_PROFILES: 'local-infra,edge,load-test',
      CADDY_WEB_DOMAIN: 'web.example.test',
      CADDY_DOMAIN: 'api.example.test',
      COMPOSE_DATABASE_URL: pg,
      MIGRATION_DATABASE_URL: pg,
      POSTGRES_TLS_CA_DIR: join(directory, 'ca'),
      POSTGRES_TLS_SERVER_DIR: join(directory, 'ca'),
      COMPOSE_NETWORK_SUBNET: '172.30.240.0/24',
      COMPOSE_WEB_IPV4: '172.30.240.10',
      LOAD_TEST_RUN_ID: 'configproof',
      LOAD_TEST_GENERATOR_IP: '192.0.2.2',
      LOAD_TEST_CLIENT_CA_DIR: join(directory, 'ca'),
      LOAD_TEST_SECRETS_DIR: directory,
    })
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    { mode: 0o600 }
  )
  const override = join(directory, 'migration-cli.override.yml')
  await writeFile(
    override,
    `services:\n  migrate:\n    environment:\n      DATABASE_URL: 'postgresql://fixture:fixture@postgres:5432/amcore?sslmode=require&sslaccept=strict&sslcert=${CA}'\n`,
    { mode: 0o600 }
  )
  const render = (selection) =>
    JSON.parse(
      execFileSync(
        'docker',
        [
          'compose',
          '--project-directory',
          resolve('.'),
          '--env-file',
          envFile,
          '-p',
          project,
          ...selection.flatMap((f) => ['-f', f]),
          'config',
          '--format',
          'json',
        ],
        { env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: 'utf8' }
      )
    )
  const baseline = render(files)
  const effective = render([...files, override])
  assert.equal(checkOverride(baseline, effective), true)
  assert.deepEqual(checkTarget(effective, project, 'configproof'), [])
  effective.services.migrate.volumes[0].read_only = false
  assert.ok(checkTarget(effective, project, 'configproof').length)
  assert.equal(checkOverride(baseline, effective), false)
  console.log(
    'load Compose: actual overlay/native URL/CA/owned-target render PASS; foreign delta rejected'
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
