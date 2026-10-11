import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { create } from './create.mjs'
import { configuration } from './config.mjs'
import { directory } from './state.mjs'

// Fully Console-owned profile proof; disabled scaffolding removes it with the fixture modules.
test('notification preview provider stays on the owned internal network with persistent fake outcomes', async () => {
  const id = `notification-config-${randomUUID()}`
  try {
    const m = await create(id, 'preview', 'path', false, 'notification-work')
    await configuration(m)
    const provider = m.model.services['notification-provider']
    assert.equal(provider.image, `${m.project}-api:latest`)
    assert.equal(provider.ports, undefined)
    assert.equal(provider.environment, undefined)
    assert.equal(provider.volumes.length, 1)
    assert.equal(provider.volumes[0].target, '/app/uploads')
    assert.equal(provider.labels['org.amcore.stand'], m.uuid)
    assert.equal(provider.command[0], 'node')
    for (const role of ['api', 'worker']) {
      assert.equal(
        m.model.services[role].environment.TELEGRAM_API_BASE_URL,
        'http://notification-provider:8099'
      )
      assert.equal(m.model.services[role].environment.TELEGRAM_BOT_TOKEN, '<fake-preview-token>')
    }
    assert.ok(m.services.includes('notification-provider'))
    assert.equal(m.model.volumes.notification_provider_data.labels['org.amcore.stand'], m.uuid)
  } finally {
    await rm(directory(id), { recursive: true, force: true })
  }
})
