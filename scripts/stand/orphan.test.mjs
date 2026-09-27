import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, mkdir, symlink, rename, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root, directory, load } from './state.mjs'
import { snapshot } from './snapshot.mjs'
import { run } from './process.mjs'
import { discover } from './ownership.mjs'

test('missing-worktree orphan is listed and selected cleanup proves resources without config/marker', async () => {
  const home = await mkdtemp(join(tmpdir(), 'amcore-orphan-proof-'))
  const original = `${home}/checkout`
  const retained = `${home}/retained-source`
  const id = `orphan-${randomUUID()}`
  await snapshot(root, original)
  await run('git', ['init', '--quiet'], { cwd: original })
  await symlink(`${root}/node_modules`, `${original}/node_modules`)
  const program = `
    const { create } = await import('./scripts/stand/create.mjs');
    const { configuration } = await import('./scripts/stand/config.mjs');
    const { compose } = await import('./scripts/stand/docker.mjs');
    const { discover } = await import('./scripts/stand/ownership.mjs');
    const { lease } = await import('./scripts/stand/state.mjs');
    const held = await lease(${JSON.stringify(id)}, 'orphan-proof');
    try {
      const m = await create(${JSON.stringify(id)}, 'e2e', 'path');
      await configuration(m);
      await compose(m, ['up', '-d', '--wait', '--no-deps', 'postgres', 'redis']);
      await discover(m);
    } finally { await held.release(); }
  `
  let verified = false
  try {
    await run(process.execPath, ['--input-type=module', '-e', program], { cwd: original })
    await mkdir(directory(id), { recursive: true, mode: 0o700 })
    await cp(`${original}/.amcore/stands/${id}/manifest.json`, `${directory(id)}/manifest.json`)
    await assert.rejects(() => load(id), /Foreign/)
    await assert.rejects(() => load(id, true), /missing original worktree/)
    // Preserve all source/recovery data while simulating a missing original path.
    await rename(original, retained)
    const m = await load(id, true)
    const listing = await run(process.execPath, ['scripts/stand.mjs', 'list'], { capture: true })
    assert.match(listing, new RegExp(`${m.uuid}:.*orphan source missing`))
    await run(process.execPath, ['scripts/stand.mjs', 'down', '--id', id, '--orphan', '--purge'])
    assert.equal((await load(id, true)).state, 'purged')
    assert.deepEqual(await discover(m, false), { container: [], network: [], volume: [] })
    await writeFile(
      `${directory(id)}/orphan-proof.json`,
      JSON.stringify({ verified: true, uuid: m.uuid })
    )
    verified = true
  } finally {
    if (verified) {
      await rm(home, { recursive: true })
      await rm(directory(id), { recursive: true })
    } else console.error(`Orphan proof incomplete; preserve recovery: ${home}, ${directory(id)}`)
  }
})
