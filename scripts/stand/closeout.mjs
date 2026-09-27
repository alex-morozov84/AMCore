import { readdir, access } from 'node:fs/promises'
import { root, stateRoot, load, lease, save } from './state.mjs'
import { cleanup, discover } from './ownership.mjs'
import { assertNoSurvivors } from './survivors.mjs'
import { engine } from './docker.mjs'
import { run } from './process.mjs'

export async function closeout() {
  const records = []
  for (const id of await readdir(stateRoot).catch((e) => {
    if (e.code !== 'ENOENT') throw e
    return []
  })) {
    const present = await access(`${stateRoot}/${id}/manifest.json`).then(
      () => true,
      (e) => {
        if (e.code !== 'ENOENT') throw e
        return false
      }
    )
    if (present) records.push(await load(id))
  }
  for (const m of records) {
    const held = await lease(m.id, 'closeout')
    try {
      await closeoutStand(m)
      console.log(`${m.id}: processes/resources removed`)
    } finally {
      await held.release()
    }
  }
  const current = await engine()
  for (const kind of ['container', 'network', 'volume']) {
    const ids = await run(
      'docker',
      [
        '--context',
        current.context,
        kind,
        'ls',
        kind === 'container' ? '-aq' : '-q',
        '--filter',
        `label=org.amcore.worktree=${root}`,
      ],
      { capture: true }
    )
    if (ids.trim())
      throw new Error(`Unrecorded ${kind} remains; preserve recovery data, closeout incomplete`)
  }
  console.log('Closeout verified; worktree/runtime recovery records may now be removed.')
}

export async function closeoutStand(m) {
  try {
    await assertNoSurvivors(m)
    if (!m.mocked) {
      await cleanup(m, true)
      const remaining = await discover(m, false)
      if (Object.values(remaining).some((ids) => ids.length))
        throw new Error('Stand resources remain')
    }
    await assertNoSurvivors(m)
    m.state = 'purged'
    m.closeout = { verifiedAt: new Date().toISOString() }
    await save(m)
  } catch (error) {
    m.closeout = { incomplete: true, failedAt: new Date().toISOString(), reason: error.message }
    await save(m)
    throw error
  }
}
