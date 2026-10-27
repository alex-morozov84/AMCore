// preflight.sh plan: topology refusals and "no mutating docker call" (docker is a stub that
// records every invocation). The trust-boundary checker is tested on adapted-config shapes.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkLoadTestConfig } from '../load-test/caddy-check.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const FILES =
  'docker-compose.yml:docker/compose/postgres-tls.yml:docker/compose/web.yml:docker/compose/bff-relay.yml:docker/compose/load-test.yml'

function checkout({ context = {}, env = {} } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'lt-preflight-'))
  mkdirSync(join(d, 'ca'))
  mkdirSync(join(d, 'secrets'))
  mkdirSync(join(d, 'bin'))
  writeFileSync(join(d, 'ca/ca.crt'), 'test ca\n')
  writeFileSync(join(d, 'secrets/fixture-password'), 'x'.repeat(24))
  const ctx = { i18n_mode: 'multi', base_locale: 'en', admin_console_mode: 'path', ...context }
  writeFileSync(
    join(d, 'PROJECT_CONTEXT.md'),
    Object.entries(ctx)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `- **${k}:** ${v}`)
      .join('\n')
  )
  if (env.COMPOSE_FILE) env.COMPOSE_FILE += `:${join(d, 'migration-cli.override.yml')}`
  const values = {
    COMPOSE_PROJECT_NAME: 'amcore-loadtest-lt1025a',
    COMPOSE_FILE: `${FILES}:${join(d, 'migration-cli.override.yml')}`,
    COMPOSE_PROFILES: 'local-infra,edge',
    LOAD_TEST_RUN_ID: 'lt1025a',
    LOAD_TEST_GENERATOR_IP: '203.0.113.7',
    LOAD_TEST_CLIENT_CA_DIR: join(d, 'ca'),
    LOAD_TEST_SECRETS_DIR: join(d, 'secrets'),
    COMPOSE_WEB_IPV4: '10.77.0.10',
    CADDY_DOMAIN: 'api.example.test',
    CADDY_WEB_DOMAIN: 'app.example.test',
    ...env,
  }
  writeFileSync(
    join(d, '.env'),
    Object.entries(values)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  )
  // The stub logs its arguments and prints an empty JSON object for `caddy adapt`.
  writeFileSync(
    join(d, 'bin/docker'),
    `#!/bin/sh\necho "$*" >> "${join(d, 'docker.log')}"\ncase "$*" in *" adapt "*) echo '{}' ;; esac\nexit 0\n`
  )
  chmodSync(join(d, 'bin/docker'), 0o755)
  writeFileSync(join(d, 'docker.log'), '')
  writeFileSync(join(d, 'migration-cli.override.yml'), 'services: {}')
  writeFileSync(
    join(d, 'preflight.sh'),
    readFileSync(join(ROOT, 'scripts/load-test/preflight.sh'), 'utf8')
      .replace(
        '/srv/amcore-secrets/migration-cli.override.yml',
        join(d, 'migration-cli.override.yml')
      )
      .replace('. "$(dirname "$0")/lib.sh"', `. "${join(ROOT, 'scripts/load-test/lib.sh')}"`)
  )
  return d
}

function preflight(d, mode = 'plan') {
  const r = spawnSync('sh', [join(d, 'preflight.sh'), mode], {
    cwd: d,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(d, 'bin')}:${process.env.PATH}` },
  })
  const calls = readFileSync(join(d, 'docker.log'), 'utf8').split('\n').filter(Boolean)
  return { ...r, calls }
}

const mutating = (calls) =>
  calls.filter(
    (c) =>
      !/^compose (--project-directory \S+ -p \S+ )?config\b/.test(c) && !c.startsWith('run --rm ')
  )

test('plan accepts the supported path topologies and never mutates', () => {
  for (const [label, context, prefix] of [
    ['multi-locale path Console', {}, "'/en'"],
    ['single locale', { i18n_mode: 'single' }, "''"],
    ['Console disabled', { admin_console_mode: null }, "'/en'"],
  ]) {
    const r = preflight(checkout({ context }))
    assert.equal(r.status, 0, `${label}: ${r.stderr}`)
    assert.match(r.stdout, new RegExp(`route prefix ${prefix}`), label)
    assert.deepEqual(mutating(r.calls), [], label)
    assert.ok(
      r.calls.some((c) => / caddy validate /.test(c)) &&
        r.calls.some((c) => / caddy adapt /.test(c)),
      label
    )
  }
})

test('plan refuses unsupported topology and inputs before any docker call', () => {
  for (const [label, opts, message] of [
    ['host-mode Console', { context: { admin_console_mode: 'host' } }, /host is not supported/],
    [
      'missing overlay',
      { env: { COMPOSE_FILE: FILES.replace(':docker/compose/load-test.yml', '') } },
      /must include docker\/compose\/load-test.yml/,
    ],
    [
      'foreign overlay',
      { env: { COMPOSE_FILE: `${FILES}:docker/compose/observability.yml` } },
      /not part of the supported/,
    ],
    ['external database', { env: { COMPOSE_PROFILES: 'edge' } }, /local-infra/],
    [
      'project not derived from the run',
      { env: { COMPOSE_PROJECT_NAME: 'amcore' } },
      /amcore-loadtest-lt1025a/,
    ],
    ['bad run id', { env: { LOAD_TEST_RUN_ID: 'LT_1' } }, /LOAD_TEST_RUN_ID/],
    ['IPv6 generator', { env: { LOAD_TEST_GENERATOR_IP: '2001:db8::7' } }, /one IPv4 address/],
    ['CIDR generator', { env: { LOAD_TEST_GENERATOR_IP: '203.0.113.0/24' } }, /one IPv4 address/],
    ['missing CA', { env: { LOAD_TEST_CLIENT_CA_DIR: '/nonexistent' } }, /ca.crt/],
  ]) {
    const r = preflight(checkout(opts))
    assert.notEqual(r.status, 0, label)
    assert.match(r.stderr, message, label)
    assert.deepEqual(r.calls, [], `${label}: no docker call at all`)
  }
})

test('plan refuses a CA directory that also holds the CA private key', () => {
  const d = checkout()
  writeFileSync(join(d, 'ca/ca.key'), 'secret')
  const r = preflight(d)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /private key/)
})

const server = (listen, extra = {}) => ({ listen: [listen], routes: [], ...extra })
const strip = { handler: 'reverse_proxy', headers: { request: { delete: ['X-AMCore-Client-Ip'] } } }
const good = () => ({
  apps: {
    http: {
      servers: {
        srv0: server(':443', { routes: [{ handle: [strip] }] }),
        srv1: server(':8443', {
          trusted_proxies: { source: 'static', ranges: ['203.0.113.7/32'] },
          trusted_proxies_strict: 1,
          strict_sni_host: true,
          tls_connection_policies: [
            {
              match: { sni: ['app.example.test'] },
              client_authentication: { mode: 'require_and_verify', ca: { pem_files: ['/ca.crt'] } },
            },
            {},
          ],
          routes: [{ match: [{ host: ['app.example.test'] }], handle: [strip] }],
        }),
      },
    },
  },
})

test('trust-boundary checker accepts the intended shape and names each violation', () => {
  assert.deepEqual(checkLoadTestConfig(good(), '203.0.113.7'), [])
  const cases = [
    [
      'trust on :443',
      (c) =>
        (c.apps.http.servers.srv0.trusted_proxies = { source: 'static', ranges: ['0.0.0.0/0'] }),
      /trusted_proxies on :443/,
    ],
    [
      'wider range',
      (c) => (c.apps.http.servers.srv1.trusted_proxies.ranges = ['203.0.113.0/24']),
      /exactly 203.0.113.7\/32/,
    ],
    [
      'not strict',
      (c) => delete c.apps.http.servers.srv1.trusted_proxies_strict,
      /trusted_proxies_strict/,
    ],
    ['no strict SNI', (c) => delete c.apps.http.servers.srv1.strict_sni_host, /strict_sni_host/],
    [
      'optional client auth',
      (c) =>
        (c.apps.http.servers.srv1.tls_connection_policies[0].client_authentication.mode =
          'verify_if_given'),
      /require_and_verify/,
    ],
    [
      'claim kept',
      (c) => (c.apps.http.servers.srv1.routes[0].handle = [{ handler: 'reverse_proxy' }]),
      /does not strip/,
    ],
    [
      // Agent 2 reproduction: app and api routed, mTLS policy only for app, empty fallback.
      'routed host without client-certificate policy',
      (c) =>
        c.apps.http.servers.srv1.routes.push({
          match: [{ host: ['api.example.test'] }],
          handle: [strip],
        }),
      /routes api.example.test without a client-certificate policy/,
    ],
    [
      'route without host matcher',
      (c) => c.apps.http.servers.srv1.routes.push({ handle: [strip] }),
      /route without a host matcher/,
    ],
    [
      'client auth on :443',
      (c) =>
        (c.apps.http.servers.srv0.tls_connection_policies = [
          { client_authentication: { mode: 'require' } },
        ]),
      /:443 must not use client/,
    ],
  ]
  for (const [label, change, message] of cases) {
    const c = good()
    change(c)
    assert.match(checkLoadTestConfig(c, '203.0.113.7').join('\n'), message, label)
  }
})

test('native override must be final and unique; approved overlays keep their order', () => {
  for (const mutate of [
    (value, d) => value.replace(`:${join(d, 'migration-cli.override.yml')}`, ''),
    (value) => value.replace('COMPOSE_FILE=', 'COMPOSE_FILE=docker/compose/load-test.yml:'),
    (value, d) =>
      value.replace(
        join(d, 'migration-cli.override.yml'),
        `${join(d, 'migration-cli.override.yml')}:docker/compose/supervise.yml`
      ),
  ]) {
    const d = checkout()
    writeFileSync(join(d, '.env'), mutate(readFileSync(join(d, '.env'), 'utf8'), d))
    const r = preflight(d)
    assert.notEqual(r.status, 0)
    assert.deepEqual(r.calls, [])
  }
})
