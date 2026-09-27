import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { create } from './create.mjs'
import { configuration } from './config.mjs'
import { compose, docker } from './docker.mjs'
import { dataAdmission, cleanup, discover } from './ownership.mjs'
import { lease, save, load } from './state.mjs'

for (const unavailable of [false, true])
  test(`partial resources cleanup without marker, DB unavailable=${unavailable}`, async () => {
    const id = `lifecycle-${randomUUID()}`
    const held = await lease(id, 'lifecycle-proof')
    let m
    try {
      m = await create(id, 'e2e', 'path')
      await configuration(m)
      await save(m)
      await compose(m, ['up', '-d', '--wait', '--no-deps', 'postgres', 'redis'])
      await dataAdmission(m, true)
      await assert.rejects(() => dataAdmission(m), /marker|identity|relation/)
      await assert.rejects(() => lease(id, 'competing-down'), /busy/)
      if (unavailable) await docker(m, ['container', 'stop', m.postgres])
      await cleanup(m, true)
      assert.equal((await load(id)).state, 'purged')
      const remaining = await discover(m)
      assert.deepEqual(remaining, { container: [], network: [], volume: [] })
    } finally {
      if (m && m.state !== 'purged') await cleanup(m, true)
      await held.release()
    }
  })
