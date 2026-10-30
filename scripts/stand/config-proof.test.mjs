import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { create } from './create.mjs'
import { configuration, validateModel, labels, builtServices } from './config.mjs'
import { directory } from './state.mjs'

test('actual Compose rendering replaces poisoned ports/environment with owned local model', async () => {
  const id = `config-proof-${randomUUID()}`
  const before = { ...process.env }
  process.env.COMPOSE_DATABASE_URL = 'postgresql://foreign.invalid/db'
  process.env.MIGRATION_DATABASE_URL = 'postgresql://foreign.invalid/migrate'
  process.env.COMPOSE_FILE = 'foreign.yml'
  process.env.COMPOSE_PROFILES = 'backup,restore,monitoring'
  try {
    const m = await create(id, 'e2e', 'path')
    await configuration(m)
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

// AMCORE_CONSOLE_SUPPORT_MAIL_CONFIG_PROOF_START
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
// AMCORE_CONSOLE_SUPPORT_MAIL_CONFIG_PROOF_END

// AMCORE_CONSOLE_SUMMARY_CONFIG_PROOF_START
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
// AMCORE_CONSOLE_SUMMARY_CONFIG_PROOF_END
