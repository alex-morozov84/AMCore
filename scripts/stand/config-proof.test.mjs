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
      const changed = globalThis.structuredClone(m)
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
