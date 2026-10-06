import { readdir, access } from 'node:fs/promises'
import { root, stateRoot, load, lease, save } from './state.mjs'
import { cleanup, discover } from './ownership.mjs'
import { assertNoSurvivors } from './survivors.mjs'
import { engine } from './docker.mjs'
import { run } from './process.mjs'
import { disposeControlSocket } from './control-socket.mjs'
import { verifyRunnerRemoval } from './wrapper-removal.mjs'

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
  const accepted = []
  for (const m of records.sort((a, b) => Number(Boolean(a.wrapper)) - Number(Boolean(b.wrapper)))) {
    const held = await lease(m.id, 'closeout')
    try {
      await closeoutStand(m)
      console.log(`${m.id}: processes/resources removed`)
      // Physical absence is verified; an accepted unresolved build is NOT proof that the
      // daemon finished exporting, so it is reported separately and never as verification.
      for (const risk of m.closeout.acceptedRisk ?? []) {
        accepted.push(risk.invocation)
        console.log(
          `  ACCEPTED RISK (not proof the Docker export finished) ${risk.invocation}: ${risk.reason}`
        )
      }
    } finally {
      await held.release()
    }
  }
  const current = await engine()
  // Images need `-a --no-trunc` so dangling and unrecorded generations are inventoried too.
  const listing = {
    container: ['-aq'],
    network: ['-q'],
    volume: ['-q'],
    image: ['-a', '--no-trunc', '-q'],
  }
  for (const [kind, flags] of Object.entries(listing)) {
    const ids = await run(
      'docker',
      [
        '--context',
        current.context,
        kind,
        'ls',
        ...flags,
        '--filter',
        `label=org.amcore.worktree=${root}`,
      ],
      { capture: true }
    )
    if (ids.trim())
      throw new Error(`Unrecorded ${kind} remains; preserve recovery data, closeout incomplete`)
  }
  console.log(
    accepted.length
      ? `Closeout verified physical absence only; unresolved-build risk was ACCEPTED for ${accepted.length} attempt(s) listed above. Acceptance is not proof that no late image export remains; recovery records may be removed only with that in mind.`
      : 'Closeout verified; worktree/runtime recovery records may now be removed.'
  )
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
    await disposeControlSocket(m.controlSocket)
    await verifyRunnerRemoval(m)
    m.state = 'purged'
    const acceptedRisk = (m.builds ?? [])
      .filter((build) => build.state === 'accepted-risk')
      .map((build) => ({ invocation: build.invocation, ...build.acceptance }))
    m.closeout = {
      verifiedAt: new Date().toISOString(),
      ...(acceptedRisk.length && { acceptedRisk }),
    }
    await save(m)
  } catch (error) {
    m.closeout = { incomplete: true, failedAt: new Date().toISOString(), reason: error.message }
    await save(m)
    throw error
  }
}
