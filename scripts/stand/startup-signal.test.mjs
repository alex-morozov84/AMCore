import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { run, stopChildren } from './process.mjs'
import { directory, load } from './state.mjs'
import { cleanup, discover } from './ownership.mjs'
import { unresolvedBuilds } from './build-intent.mjs'
import { assertNoSurvivors } from './survivors.mjs'

for (const [state, signal] of [
  ['allocated', 'SIGINT'],
  ['configured', 'SIGTERM'],
  ['infrastructure-ready', 'SIGINT'],
  ['migrated', 'SIGTERM'],
  ['app-ready', 'SIGTERM'],
])
  test(`startup ${signal} at ${state} waits for children and verifies own removal`, async () => {
    const id = `signal-${randomUUID()}`
    const result = run(process.execPath, ['scripts/stand.mjs', 'e2e', '--id', id]).then(
      () => undefined,
      (error) => error
    )
    let m
    try {
      // A cold Docker dependency/build/export can exceed four minutes; this is
      // a phase-arrival deadline, separate from the signal/removal assertions.
      const deadline = Date.now() + 600_000
      while (Date.now() < deadline) {
        m = await load(id).catch((error) => {
          if (error.code !== 'ENOENT') throw error
        })
        if (m?.state === state) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      assert.equal(m?.state, state, 'startup never reached requested interruption phase')
      if (state === 'configured')
        await assert.rejects(
          () =>
            run(process.execPath, ['scripts/stand.mjs', 'down', '--id', id, '--purge'], {
              capture: true,
            }),
          /busy/
        )
      const owner = JSON.parse(await readFile(`${directory(id)}/lease/owner.json`, 'utf8'))
      assert.equal((await load(id)).state, state, 'phase advanced before the signal')
      process.kill(owner.pid, signal)
      const error = await result
      assert.match(error?.message ?? '', signal === 'SIGINT' ? /130/ : /143/)
      m = await load(id)
      await assert.rejects(() => readFile(`${directory(id)}/lease/owner.json`), { code: 'ENOENT' })
      await assertNoSurvivors(m)
      assert.deepEqual(await discover(m, false), { container: [], network: [], volume: [] })
      if (unresolvedBuilds(m).length) {
        // Interrupted while `compose build` ran: nothing proves Docker finished exporting,
        // so the record is kept and purge reports incomplete until risk is accepted.
        assert.notEqual(m.state, 'purged')
        await assert.rejects(() => cleanup(m, true), { code: 'BUILD_UNRESOLVED' })
        await cleanup(m, true, {
          acceptReason: 'startup signal proof accepts an interrupted build',
        })
        assert.equal(m.builds.at(-1).state, 'accepted-risk')
      }
      assert.equal(m.state, 'purged')
    } finally {
      await stopChildren()
      await result
      if (m && m.state !== 'purged') await cleanup(m, true)
    }
  })
