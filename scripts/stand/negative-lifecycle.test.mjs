import { localSql } from './local-sql.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { create } from './create.mjs'
import { configuration } from './config.mjs'
import { compose, docker, inspect } from './docker.mjs'
import { dataAdmission, cleanup, discover } from './ownership.mjs'
import { lease, save, load } from './state.mjs'
import { closeoutStand } from './closeout.mjs'
import { start } from './start.mjs'

test('marker bootstrap failure preserves recovery and permits physical cleanup', async () => {
  const id = `marker-failure-${randomUUID()}`
  const held = await lease(id, 'marker-failure-proof')
  let m
  try {
    m = await create(id, 'e2e', 'path')
    await configuration(m)
    await save(m)
    await compose(m, ['up', '-d', '--wait', '--no-deps', 'postgres', 'redis'])
    await dataAdmission(m, true)
    await localSql(m, 'CREATE SCHEMA stand_meta;')
    await assert.rejects(() => start(m), /already exists/)
    assert.ok((await load(id)).resources.volume.length)
    await assert.rejects(() => dataAdmission(m), /relation|identity/)
    await closeoutStand(m)
    assert.deepEqual(await discover(m, false), { container: [], network: [], volume: [] })
  } finally {
    if (m && m.state !== 'purged') await cleanup(m, true)
    await held.release()
  }
})

test('wrong marker denies data; a foreign network attachment blocks closeout before mutation', async () => {
  const id = `negative-${randomUUID()}`
  const held = await lease(id, 'negative-lifecycle-proof')
  let m, foreign
  try {
    m = await create(id, 'e2e', 'path')
    await configuration(m)
    await save(m)
    await compose(m, ['up', '-d', '--wait', '--no-deps', 'postgres', 'redis'])
    await dataAdmission(m, true)
    await localSql(
      m,
      `CREATE SCHEMA stand_meta; CREATE TABLE stand_meta.identity(uuid text); INSERT INTO stand_meta.identity VALUES ('wrong-marker');`
    )
    await assert.rejects(() => dataAdmission(m), /marker mismatch/)
    const redis = await inspect(m, 'container', m.redis)
    foreign = (
      await docker(
        m,
        ['run', '-d', '--network', m.resources.network[0], redis.Image, 'sleep', '600'],
        { capture: true }
      )
    ).trim()
    const before = await discover(m, false)
    await assert.rejects(() => dataAdmission(m, true), /Foreign attachment/)
    await assert.rejects(() => closeoutStand(m), /Foreign attachment/)
    assert.deepEqual(await discover(m, false), before)
    assert.equal((await load(id)).closeout.incomplete, true)
    assert.equal((await inspect(m, 'container', foreign)).State.Running, true)
    await docker(m, ['container', 'rm', '-f', foreign])
    foreign = undefined
    await closeoutStand(m)
    assert.deepEqual(await discover(m, false), { container: [], network: [], volume: [] })
  } finally {
    if (foreign) await docker(m, ['container', 'rm', '-f', foreign])
    if (m && m.state !== 'purged') await cleanup(m, true)
    await held.release()
  }
})
