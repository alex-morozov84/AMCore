import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { create } from './create.mjs'
import { configuration } from './config.mjs'
import { compose, docker } from './docker.mjs'
import { dataAdmission, cleanup, discover } from './ownership.mjs'
import { lease, save, load } from './state.mjs'
import { closeoutStand } from './closeout.mjs'
import { run, stopChildren } from './process.mjs'

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
      if (!unavailable) await proveIncompleteCloseout(m)
      await closeoutStand(m)
      assert.equal((await load(id)).state, 'purged')
      assert.ok((await load(id)).closeout.verifiedAt)
      const remaining = await discover(m)
      assert.deepEqual(remaining, { container: [], network: [], volume: [] })
    } finally {
      if (m && m.state !== 'purged') await cleanup(m, true)
      await held.release()
    }
  })

async function proveIncompleteCloseout(m) {
  const child = run(process.execPath, ['-e', 'setInterval(() => {}, 1000)', m.snapshot], {
    capture: true,
  }).catch((error) => error)
  try {
    await new Promise((resolve) => setTimeout(resolve, 100))
    await assert.rejects(() => closeoutStand(m), /surviv/i)
    assert.equal((await load(m.id)).closeout.incomplete, true)
    assert.ok((await discover(m, false)).volume.length, 'recovery volumes were removed')
  } finally {
    await stopChildren()
    await child
  }
}
