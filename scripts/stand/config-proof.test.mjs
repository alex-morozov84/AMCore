import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rm, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { composeArguments } from './docker.mjs'
import { create } from './create.mjs'
import { configuration, validateModel, labels, builtServices } from './config.mjs'
import { directory } from './state.mjs'

function assertCollectorPolicy(m, required) {
  const collector = m.model.services['mail-capture']
  if (!required) {
    const changed = globalThis.structuredClone(m)
    changed.model.services['mail-capture'] = {}
    assert.throws(() => validateModel(changed), /Unexpected setup mail collector/)
    return
  }
  assert.equal(collector.read_only, true)
  assert.equal(Object.hasOwn(collector, 'build'), false)
  for (const [field, values] of [
    ['read_only', [undefined, false, 'true', 1]],
    ['build', [undefined, null, false, {}, { context: m.snapshot }]],
    ['image', ['foreign:latest']],
    ['ports', [[{ target: 8099, published: '19099' }]]],
    ['volumes', [[{ type: 'volume', source: 'foreign', target: '/mail' }]]],
    [
      'environment',
      [{ ...collector.environment, AMCORE_SETUP_MAIL_CAPTURE_KEY: '<fake-wrong-key>' }],
    ],
  ]) {
    for (const value of values) {
      const changed = globalThis.structuredClone(m)
      changed.model.services['mail-capture'][field] = value
      assert.throws(() => validateModel(changed), /Unsafe setup mail collector/)
    }
  }
  const missing = globalThis.structuredClone(m)
  delete missing.model.services['mail-capture'].read_only
  assert.throws(() => validateModel(missing), /Unsafe setup mail collector/)
}

test('actual Compose rendering replaces poisoned ports/environment with owned local model', async () => {
  const id = `config-proof-${randomUUID()}`
  const before = { ...process.env }
  process.env.COMPOSE_DATABASE_URL = 'postgresql://foreign.invalid/db'
  process.env.MIGRATION_DATABASE_URL = 'postgresql://foreign.invalid/migrate'
  process.env.COMPOSE_FILE = 'foreign.yml'
  process.env.COMPOSE_PROFILES = 'backup,restore,monitoring'
  process.env.HEALTH_DISK_THRESHOLD_PERCENT = '0.4'
  try {
    const m = await create(id, 'e2e', 'path')
    const base = join(m.snapshot, 'docker-compose.yml')
    const source = await readFile(base, 'utf8')
    assert.ok(source.includes('${HEALTH_DISK_THRESHOLD_PERCENT:-0.9}'))
    await writeFile(
      base,
      source.replace(
        '${HEALTH_DISK_THRESHOLD_PERCENT:-0.9}',
        '${HEALTH_DISK_THRESHOLD_PERCENT:-0.3}'
      )
    )
    await configuration(m)
    for (const name of ['api', 'worker'])
      assert.equal(m.model.services[name].environment.HEALTH_DISK_THRESHOLD_PERCENT, '0.9')
    const rendered = execFileSync(
      'docker',
      ['--host', m.engine.endpoint, ...composeArguments(m), 'config', '--format', 'json'],
      { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }
    )
    for (const name of ['api', 'worker'])
      assert.equal(
        JSON.parse(rendered).services[name].environment.HEALTH_DISK_THRESHOLD_PERCENT,
        '0.9'
      )
    for (const name of ['api', 'worker']) {
      for (const value of [undefined, '0.75']) {
        const changed = globalThis.structuredClone(m)
        if (value === undefined)
          delete changed.model.services[name].environment.HEALTH_DISK_THRESHOLD_PERCENT
        else changed.model.services[name].environment.HEALTH_DISK_THRESHOLD_PERCENT = value
        assert.throws(() => validateModel(changed), /Managed disk readiness/)
      }
    }
    assert.equal(m.model.services.postgres.ports, undefined)
    assert.equal(m.model.services.api.environment.GEOIP_ENABLED, 'false')
    const keys = m.model.services.api.environment.MFA_ENCRYPTION_KEYS
    assert.equal(m.model.services.api.environment.MFA_ACTIVE_KEY_ID, 'managed-e2e')
    assert.equal(m.model.services.worker.environment.MFA_ENCRYPTION_KEYS, keys)
    for (const service of ['web', 'seed', 'migrate']) {
      assert.equal(m.model.services[service].environment.MFA_ENCRYPTION_KEYS, undefined)
      assert.equal(m.model.services[service].environment.MFA_ACTIVE_KEY_ID, undefined)
    }
    assert.equal(
      m.model.services.api.environment.DATABASE_URL,
      m.model.services.migrate.environment.E2E_DATABASE_URL
    )
    const seed = m.model.services.seed
    assert.equal(seed.environment.DATABASE_URL, m.model.services.api.environment.DATABASE_URL)
    assert.equal(seed.build.target, 'build')
    assert.equal(seed.build.context, m.snapshot)
    assert.equal(seed.working_dir, '/app/apps/api')
    assert.equal(seed.user, 'node')
    assert.equal(seed.init, true)
    assert.deepEqual(seed.command, ['./node_modules/.bin/tsx', 'prisma/seed.ts'])
    assert.deepEqual(seed.build.labels, labels(m))
    assert.ok(builtServices.includes('seed'))
    assert.equal(m.model.services.migrate.build.target, 'migrator')
    for (const mutate of [
      (s) => {
        s.build.target = 'migrator'
      },
      (s) => {
        s.environment.DATABASE_URL = 'postgresql://foreign.invalid/db'
      },
      (s) => {
        s.command = ['node', '-e', 'process.exit(0)']
      },
      (s) => {
        s.user = 'root'
      },
      (s) => {
        s.ports = [{ host_ip: '127.0.0.1', published: 20001, target: 5002 }]
      },
      (s) => {
        s.volumes = [{ type: 'volume', source: 'foreign' }]
      },
      (s) => {
        delete s.build.labels['org.amcore.attempt']
      },
    ]) {
      const changed = globalThis.globalThis.structuredClone(m)
      mutate(changed.model.services.seed)
      assert.throws(() => validateModel(changed))
    }
    assert.equal(m.model.services.web.environment.API_URL, 'http://api:5002')
    assert.equal(m.model.services.web.ports.length, 1)
    assert.equal(m.model.services.web.ports[0].host_ip, '127.0.0.1')
  } finally {
    process.env = before
    await rm(directory(id), { recursive: true, force: true })
  }
})

for (const mode of ['path', 'host']) {
  test(`support-mail-${mode} renders its closed, internal-mail topology`, async () => {
    const id = `support-mail-config-${randomUUID()}`
    try {
      const m = await create(id, 'e2e', undefined, false, `support-mail-${mode}`)
      await configuration(m)
      assert.equal(m.consoleTopology, mode)
      assert.equal(m.topology, 'host')
      assert.equal(m.productAdminHost, true)
      assert.equal(Boolean(m.origins.console), mode === 'host')
      for (const name of ['api', 'worker']) {
        const env = m.model.services[name].environment
        assert.equal(env.NODE_ENV, 'development')
        assert.equal(env.EMAIL_PROVIDER, 'resend')
        assert.equal(env.RESEND_API_KEY, '<fake-e2e-provider-key>')
        assert.equal(env.AUTH_PUBLIC_SIGNUP_ENABLED, 'false')
        assert.equal(env.ORG_SELF_SERVICE_CREATION_ENABLED, 'false')
        assert.equal(env.AMCORE_SETUP_MAIL_CAPTURE_KEY, m.mailCaptureKey)
      }
      assert.equal(m.model.services['mail-capture'].ports, undefined)
      assert.equal(m.model.services['mail-capture'].volumes, undefined)
    } finally {
      await rm(directory(id), { recursive: true, force: true })
    }
  })
}

test('console summary E2E owns its internal fault source and loopback offline Grafana', async () => {
  const id = `summary-config-${randomUUID()}`
  try {
    const m = await create(id, 'e2e', 'path', false, 'console-summary')
    await configuration(m)
    assert.equal(m.model.services.web.environment.API_URL, 'http://summary-source:8098')
    assert.equal(
      m.model.services.web.environment.ADMIN_CONSOLE_METRICS_GRAFANA_URL,
      `${m.origins.metrics}/d/console-summary/fixture`
    )
    assert.equal(m.origins.metrics, `http://127.0.0.1:${m.ports.tls}`)
    assert.equal(m.model.services['summary-source'].ports, undefined)
    const grafana = m.model.services['summary-grafana']
    assert.match(grafana.image, /grafana:13\.2\.1@sha256:/)
    assert.equal(grafana.ports[0].host_ip, '127.0.0.1')
    assert.equal(grafana.environment.GF_PLUGINS_PREINSTALL_DISABLED, 'true')
    const wrong = globalThis.structuredClone(m)
    wrong.origins.metrics = 'https://foreign.invalid'
    assert.throws(() => validateModel(wrong))
    const wrongApi = globalThis.structuredClone(m)
    wrongApi.model.services.web.environment.API_URL = 'http://foreign.invalid'
    assert.throws(() => validateModel(wrongApi))
    await assert.rejects(() =>
      create(`summary-preview-${randomUUID()}`, 'preview', 'path', false, 'console-summary')
    )
  } finally {
    await rm(directory(id), { recursive: true, force: true })
  }
})

for (const [profile, fixture, topology, consoleMode, staffMode, provider, mail] of [
  [
    'product-admin-oauth-path',
    'product-admin-oauth-path',
    undefined,
    'host',
    'path',
    'mock',
    false,
  ],
  ['product-admin-oauth', 'product-admin-oauth', undefined, 'path', 'host', 'mock', false],
  [
    'product-admin-console-path',
    'product-admin-console-path',
    undefined,
    'path',
    'host',
    'mock',
    false,
  ],
  [
    'product-admin-three-host',
    'product-admin-three-host',
    undefined,
    'host',
    'host',
    'mock',
    false,
  ],
  ['host', undefined, 'host', 'host', 'path', 'mock', false],
  ['setup-cli', 'organization-setup', undefined, 'path', 'path', 'mock', true],
  ['setup-console', 'organization-setup', 'host', 'host', 'path', 'mock', true],
  ['staff-invitation', 'product-admin-closed-signup', undefined, 'path', 'host', 'mock', true],
  ['support-mail-path', 'support-mail-path', undefined, 'path', 'host', 'resend', true],
  ['support-mail-host', 'support-mail-host', undefined, 'host', 'host', 'resend', true],
  [
    'organization-provisioning',
    'organization-provisioning',
    undefined,
    'path',
    'path',
    'resend',
    true,
  ],
]) {
  test(`${profile} resolved readiness and single-stack resource closure survive conflicts`, async () => {
    const id = `staff-readiness-${randomUUID()}`
    const before = process.env.HEALTH_DISK_THRESHOLD_PERCENT
    process.env.HEALTH_DISK_THRESHOLD_PERCENT = '0.4'
    try {
      const m = await create(id, 'e2e', topology, false, fixture)
      const base = join(m.snapshot, 'docker-compose.yml')
      const source = await readFile(base, 'utf8')
      assert.ok(source.includes('${HEALTH_DISK_THRESHOLD_PERCENT:-0.9}'))
      await writeFile(
        base,
        source.replaceAll(
          '${HEALTH_DISK_THRESHOLD_PERCENT:-0.9}',
          '${HEALTH_DISK_THRESHOLD_PERCENT:-0.3}'
        )
      )
      await configuration(m)
      const rendered = JSON.parse(
        execFileSync(
          'docker',
          ['--host', m.engine.endpoint, ...composeArguments(m), 'config', '--format', 'json'],
          { encoding: 'utf8', timeout: 10000 }
        )
      )
      const expectedTopology = ['setup-cli', 'organization-provisioning'].includes(profile)
        ? 'path'
        : 'host'
      assert.deepEqual(
        Object.keys(rendered.services).sort(),
        [
          'api',
          'migrate',
          'postgres',
          'redis',
          'seed',
          'web',
          'worker',
          ...(expectedTopology === 'host' ? ['caddy'] : []),
          ...(mail ? ['mail-capture'] : []),
        ].sort()
      )
      for (const [name, target] of Object.entries({
        api: undefined,
        worker: undefined,
        web: undefined,
        seed: 'build',
        migrate: 'migrator',
      })) {
        assert.equal(rendered.services[name].build.target, target)
        assert.equal(rendered.services[name].build.context, m.snapshot)
      }
      for (const app of ['api', 'web']) {
        const dockerfile = await readFile(join(m.snapshot, `apps/${app}/Dockerfile`), 'utf8')
        assert.match(dockerfile.match(/^FROM .+$/gm).at(-1), / AS runner$/)
      }
      assert.equal(m.topology, expectedTopology)
      assert.equal(m.productAdminHost, staffMode === 'host')
      if (profile.startsWith('product-admin-'))
        assert.equal(m.consoleTopology, profile === 'product-admin-three-host' ? 'host' : 'path')
      for (const name of ['api', 'worker']) {
        assert.equal(rendered.services[name].environment.HEALTH_DISK_THRESHOLD_PERCENT, '0.9')
        assert.equal(rendered.services[name].environment.EMAIL_PROVIDER, provider)
        for (const value of [undefined, '0.75']) {
          const changed = globalThis.structuredClone(m)
          if (value === undefined)
            delete changed.model.services[name].environment.HEALTH_DISK_THRESHOLD_PERCENT
          else changed.model.services[name].environment.HEALTH_DISK_THRESHOLD_PERCENT = value
          assert.throws(() => validateModel(changed), /Managed disk readiness/)
        }
      }
      assert.equal(
        rendered.services.api.environment.NODE_OPTIONS,
        fixture?.includes('oauth') ? '--import=/app/fixtures/apple-oidc.mjs' : undefined
      )
      assert.equal(rendered.services.worker.environment.NODE_OPTIONS, undefined)
      const placement = JSON.parse(
        await readFile(join(m.snapshot, 'packages/shared/src/config/product-admin.json'), 'utf8')
      )
      const console = JSON.parse(
        await readFile(join(m.snapshot, 'packages/shared/src/config/admin-console.json'), 'utf8')
      )
      assert.equal(placement.mode, staffMode)
      assert.equal(console.mode, consoleMode)
      assertCollectorPolicy(m, mail)
    } finally {
      if (before === undefined) delete process.env.HEALTH_DISK_THRESHOLD_PERCENT
      else process.env.HEALTH_DISK_THRESHOLD_PERCENT = before
      await rm(directory(id), { recursive: true, force: true })
    }
  })
}
