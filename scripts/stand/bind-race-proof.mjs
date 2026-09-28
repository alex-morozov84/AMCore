import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { create } from './create.mjs'
import { boot } from './boot.mjs'
import { cleanup, discover } from './ownership.mjs'
import { lease } from './state.mjs'
import { configuration } from './config.mjs'
import { docker, inspect } from './docker.mjs'

const id = `bind-race-${randomUUID()}`
const held = await lease(id, 'bind-race-proof')
const m = await create(id, 'e2e', 'path')
const previous = { uuid: m.uuid, project: m.project, redis: m.ports.redis }
let foreign
try {
  await configuration(m)
  foreign = (
    await docker(
      m,
      ['run', '-d', '-p', `127.0.0.1:${previous.redis}:6379`, m.model.services.redis.image],
      { capture: true }
    )
  ).trim()
  const before = await inspect(m, 'container', foreign)
  await boot(m, true)
  assert.notEqual(m.uuid, previous.uuid)
  assert.notEqual(m.ports.redis, previous.redis)
  const after = await inspect(m, 'container', foreign)
  assert.equal(after.State.Running, true)
  assert.deepEqual(after.Config, before.Config)
  assert.deepEqual(after.HostConfig, before.HostConfig)
  await cleanup(m, true)
  assert.deepEqual(await discover(m, false), { container: [], network: [], volume: [] })
  console.log(
    'Actual Docker bind race: reallocated; foreign container untouched; own resources removed.'
  )
} finally {
  if (m.state !== 'purged') await cleanup(m, true)
  if (foreign) await docker(m, ['container', 'rm', '-f', foreign])
  await held.release()
}
