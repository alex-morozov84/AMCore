// C1: the write target is the effective project of the deployment .env, proved from the
// rendered configuration and the running postgres container, whatever the shell exports.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { checkTarget } from '../load-test/target-check.mjs'
import { ROOT, stubWorld } from './load-test-stubs.mjs'

const RUN = 'reviewa'
const PROJECT = `amcore-loadtest-${RUN}`
const VOLUME = `${PROJECT}_postgres_data_pg18`
const db = (role, host = 'postgres') =>
  `postgresql://${role}:x@${host}:5432/amcore?sslmode=verify-full&sslrootcert=/c`
const config = (o = {}) => ({
  name: PROJECT,
  services: {
    api: { environment: { DATABASE_URL: o.apiUrl ?? db('runtime') } },
    worker: { environment: { DATABASE_URL: db('runtime') } },
    migrate: { environment: { DATABASE_URL: db('migrator') } },
    'load-fixture': { environment: { MIGRATION_DATABASE_URL: o.fixtureUrl ?? db('migrator') } },
    web: { environment: { API_URL: 'http://api:5002' } },
    postgres: {
      volumes: [{ type: 'volume', source: 'postgres_data_pg18', target: '/var/lib/postgresql' }],
    },
  },
  volumes: {
    postgres_data_pg18: { name: o.volumeName ?? VOLUME, labels: { 'org.amcore.load-test': RUN } },
  },
})
const inspect = (o = {}) => [
  {
    Config: {
      Labels: {
        'com.docker.compose.project': o.project ?? PROJECT,
        'com.docker.compose.service': 'postgres',
      },
    },
    Mounts: [{ Type: 'volume', Name: o.mount ?? VOLUME, Destination: '/var/lib/postgresql' }],
  },
]

test('target check accepts the run project and names every mismatch', () => {
  assert.deepEqual(checkTarget(config(), PROJECT, RUN, inspect()), [])
  const cases = [
    ['other project', config(), `${PROJECT}x`, inspect(), /effective project/],
    [
      'external app database',
      config({ apiUrl: db('runtime', 'db.example.com') }),
      PROJECT,
      inspect(),
      /api: DATABASE_URL points at db.example.com/,
    ],
    [
      'loader without TLS',
      config({ fixtureUrl: db('migrator').replace('verify-full', 'disable') }),
      PROJECT,
      inspect(),
      /load-fixture: MIGRATION_DATABASE_URL lacks sslmode=verify-full/,
    ],
    [
      'other volume',
      config({ volumeName: 'amcore_postgres_data_pg18' }),
      PROJECT,
      inspect(),
      /database volume is amcore_postgres_data_pg18/,
    ],
    [
      'running postgres of another project',
      config(),
      PROJECT,
      inspect({ project: 'amcore' }),
      /running postgres belongs to project amcore/,
    ],
    [
      'mismatched data mount',
      config(),
      PROJECT,
      inspect({ mount: 'amcore_postgres_data_pg18' }),
      /stores \/var\/lib\/postgresql in amcore_postgres_data_pg18/,
    ],
  ]
  for (const [label, c, project, i, message] of cases)
    assert.match(checkTarget(c, project, RUN, i).join('\n'), message, label)
})

function fixtureWorld(stubOptions) {
  const world = stubWorld()
  world.stub({ volumeLabel: RUN, config: config(), inspect: inspect(), ...stubOptions })
  // fixture.sh reads .env from its working directory: a minimal deployment checkout.
  writeFileSync(
    join(world.dir, '.env'),
    `LOAD_TEST_RUN_ID=${RUN}\nCOMPOSE_PROJECT_NAME=${PROJECT}\nCOMPOSE_PROFILES=local-infra,edge\n`
  )
  const run = (extra) =>
    spawnSync('sh', [join(ROOT, 'scripts/load-test/fixture.sh')], {
      cwd: world.dir,
      encoding: 'utf8',
      env: world.env(extra),
    })
  const log = () => readFileSync(join(world.dir, 'docker.log'), 'utf8')
  return { run, log }
}

test('fixture.sh ignores an exported project or database URL and runs the loader in the .env project', () => {
  const w = fixtureWorld()
  const r = w.run({
    COMPOSE_PROJECT_NAME: 'amcore-loadtest-other',
    MIGRATION_DATABASE_URL: db('x', 'elsewhere'),
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /ignoring environment variables .*COMPOSE_PROJECT_NAME/)
  const runLine = w
    .log()
    .split('\n')
    .find((l) => l.startsWith('compose') && / run --rm /.test(l))
  assert.match(runLine, new RegExp(`-p ${PROJECT} `))
  assert.match(runLine, new RegExp(`LOAD_TEST_OWNERSHIP_CHECKED=${RUN}`))
  assert.match(
    w.log(),
    /compose-run-env COMPOSE_PROJECT_NAME=\n/,
    'the loader sees no inherited project'
  )
})

test('fixture.sh refuses before the loader when the target is not the run project', () => {
  for (const [label, options] of [
    ['external app database', { config: config({ apiUrl: db('runtime', 'db.example.com') }) }],
    ['mismatched running mount', { inspect: inspect({ mount: 'amcore_postgres_data_pg18' }) }],
    ['foreign volume label', { volumeLabel: 'other' }],
  ]) {
    const w = fixtureWorld(options)
    const r = w.run()
    assert.notEqual(r.status, 0, label)
    assert.doesNotMatch(w.log(), / run --rm .*load-fixture/, `${label}: loader never started`)
  }
})
