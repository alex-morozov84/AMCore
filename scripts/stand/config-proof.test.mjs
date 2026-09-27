import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { create } from './create.mjs'
import { configuration } from './config.mjs'
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
    assert.equal(m.model.services.web.environment.API_URL, 'http://api:5002')
    assert.equal(m.model.services.web.ports.length, 1)
    assert.equal(m.model.services.web.ports[0].host_ip, '127.0.0.1')
  } finally {
    process.env = before
    await rm(directory(id), { recursive: true, force: true })
  }
})
