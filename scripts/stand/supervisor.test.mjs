import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { root, directory, lease, save } from './state.mjs'
import { supervise } from './supervisor.mjs'
import { run, cleanEnvironment } from './process.mjs'
import { allocateControlSocket } from './control-socket.mjs'

test('active controller pins transport, source and resource generation; tampering refuses before data access', async () => {
  const id = `supervisor-${randomUUID()}`
  const held = await lease(id, 'proof')
  const uuid = randomUUID()
  const m = {
    id,
    uuid,
    version: 1,
    worktree: root,
    snapshot: root,
    purpose: 'e2e',
    origins: { product: 'http://app-proof.localhost:24444' },
    ports: { web: 24444 },
    sourceHash: 'source',
    configHash: 'config',
    relay: 'http://127.0.0.1:24445',
    runToken: held.token,
    controlSocket: await allocateControlSocket(),
    resources: { container: ['owned-container'] },
    engine: { context: 'local' },
  }
  await save(m)
  const close = await supervise(m, held.token)
  const verify = () =>
    run(process.execPath, ['scripts/stand/active.mjs'], {
      cwd: root,
      capture: true,
      env: cleanEnvironment({
        AMCORE_STAND_MANIFEST: `${directory(id)}/manifest.json`,
        AMCORE_STAND_TOKEN: held.token,
        TMPDIR: `${directory(id)}/different-runner-temp`,
      }),
    })
  try {
    assert.equal(JSON.parse(await verify()).uuid, uuid)
    for (const [field, value] of [
      ['relay', 'http://foreign.invalid:24445'],
      ['ports', { web: 24446 }],
      ['sourceHash', 'other'],
      ['resources', { container: ['foreign-container'] }],
      ['engine', { context: 'foreign' }],
    ]) {
      await save({ ...m, [field]: value })
      await assert.rejects(verify, /target mismatch/)
      await save(m)
    }
  } finally {
    await close()
    await held.release()
    await rm(directory(id), { recursive: true, force: true })
  }
})
