import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { access, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acceptBuildRisk,
  assertBuildsResolved,
  beginBuild,
  runBuild,
  settleBuild,
  unresolvedBuilds,
} from './build-intent.mjs'
import { allowCleanup, requestCancellation, run, stopChildren } from './process.mjs'

const stand = () => ({
  id: 'stand-1',
  sourceHash: 'hash-1',
  engine: { context: 'local', endpoint: 'unix:///docker.sock' },
})
const recorder = () => {
  const events = []
  return {
    events,
    persist: async (m) => events.push(['save', globalThis.structuredClone(m.builds)]),
  }
}

test('intent is persisted before the build runs and settles only after a successful return', async () => {
  const m = stand()
  const { events, persist } = recorder()
  await runBuild(
    m,
    async () => {
      events.push(['build', globalThis.structuredClone(m.builds)])
    },
    persist
  )
  assert.deepEqual(
    events.map(([name]) => name),
    ['save', 'build', 'save']
  )
  assert.equal(events[0][1][0].state, 'pending')
  assert.equal(events[1][1][0].state, 'pending', 'still pending while the build runs')
  const [entry] = m.builds
  assert.equal(entry.state, 'settled')
  assert.equal(entry.outcome, 'succeeded')
  assert.equal(entry.evidence, 'compose-build-exit-0')
  assert.deepEqual(entry.services, ['migrate', 'api', 'worker', 'web'])
  assert.deepEqual([entry.sourceHash, entry.engine], [m.sourceHash, m.engine])
  assert.deepEqual(unresolvedBuilds(m), [])
})

test('every non-success outcome stays pending: no exit code, signal or error settles it', async () => {
  const failures = [
    Object.assign(new Error('docker failed (1)'), { stderr: 'canceled' }),
    new Error('docker failed (SIGTERM)'),
    new Error('spawn docker ENOENT'),
    new Error('progress stream read error'),
    new Error('Stand preparation interrupted'),
  ]
  for (const failure of failures) {
    const m = stand()
    const { persist } = recorder()
    await assert.rejects(
      () =>
        runBuild(
          m,
          async () => {
            throw failure
          },
          persist
        ),
      failure.message ? new RegExp(failure.message.split(' ')[0]) : /./
    )
    assert.equal(unresolvedBuilds(m).length, 1, failure.message)
    assert.throws(() => assertBuildsResolved(m), { code: 'BUILD_UNRESOLVED' })
  }
})

test('a crash after the build but before the terminal record leaves the intent pending', async () => {
  const m = stand()
  let saves = 0
  let onDisk
  const crashing = async (current) => {
    if (++saves === 2) throw new Error('process died while saving')
    onDisk = globalThis.structuredClone(current) // the manifest as a real writer would have stored it
  }
  await assert.rejects(() => runBuild(m, async () => {}, crashing), /died while saving/)
  assert.equal(m.builds[0].state, 'settled', 'in-memory state is not evidence')
  assert.equal(unresolvedBuilds(onDisk).length, 1, 'the stored record is still pending')
  assert.throws(() => assertBuildsResolved(onDisk), { code: 'BUILD_UNRESOLVED' })
})

test('an unresolved attempt blocks any later build and is never overwritten or hidden', async () => {
  const m = stand()
  const { persist } = recorder()
  await assert.rejects(() => runBuild(m, async () => Promise.reject(new Error('boom')), persist))
  let ran = false
  await assert.rejects(
    () =>
      runBuild(
        m,
        async () => {
          ran = true
        },
        persist
      ),
    { code: 'BUILD_UNRESOLVED' }
  )
  assert.equal(ran, false, 'second build must not start')
  assert.equal(m.builds.length, 1, 'append-only: nothing replaced')
  // Even if a later invocation were somehow settled, the older entry still counts.
  const later = await beginBuild(m, persist)
  await settleBuild(m, later, persist)
  assert.equal(m.builds.length, 2)
  assert.equal(unresolvedBuilds(m).length, 1)
  assert.throws(() => assertBuildsResolved(m), { code: 'BUILD_UNRESOLVED' })
  assert.match(
    (() => {
      try {
        assertBuildsResolved(m)
      } catch (error) {
        return error.message
      }
    })(),
    /pnpm stand down --id stand-1 --purge --accept-unresolved-build/
  )
})

test('risk acceptance needs a written reason and is recorded as acceptance, not proof', async () => {
  const m = stand()
  const { persist } = recorder()
  await assert.rejects(() => runBuild(m, async () => Promise.reject(new Error('x')), persist))
  for (const reason of [undefined, '', '   ', 'short'])
    await assert.rejects(() => acceptBuildRisk(m, reason, persist), /requires a written reason/)
  assert.equal(unresolvedBuilds(m).length, 1)
  await acceptBuildRisk(m, '  owner accepted after manual daemon check  ', persist)
  assert.equal(m.builds[0].state, 'accepted-risk')
  assert.equal(m.builds[0].acceptance.reason, 'owner accepted after manual daemon check')
  assert.ok(m.builds[0].acceptance.at)
  assert.equal(m.builds[0].outcome, undefined, 'no settled outcome is claimed')
  assert.doesNotThrow(() => assertBuildsResolved(m))
})

test('acceptance with nothing pending is a no-op and never touches settled entries', async () => {
  const m = stand()
  const { events, persist } = recorder()
  await runBuild(m, async () => {}, persist)
  const before = globalThis.structuredClone(m.builds)
  const saves = events.length
  await acceptBuildRisk(m, undefined, persist)
  assert.deepEqual(m.builds, before)
  assert.equal(events.length, saves)
})

test('exit 0 after our own signal is not E1: real executor, child handles SIGTERM and exits 0', async () => {
  const m = stand()
  const { persist } = recorder()
  // The child reports readiness once its handler is installed, so the signal is sent
  // only when the SIGTERM -> exit 0 behaviour is actually in place (no fixed delay).
  const ready = join(tmpdir(), `amcore-signal-ready-${randomUUID()}`)
  const child = `process.on('SIGTERM', () => process.exit(0)); require('node:fs').writeFileSync(${JSON.stringify(ready)}, '1'); setInterval(() => {}, 1000)`
  const running = runBuild(
    m,
    () => run(process.execPath, ['-e', child], { capture: true }),
    persist
  )
  const outcome = running.then(
    () => undefined,
    (error) => error
  )
  try {
    for (
      let i = 0;
      i < 400 &&
      !(await access(ready).then(
        () => true,
        () => false
      ));
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 25))
    await access(ready) // fails the test if the child never became ready
    requestCancellation()
    await stopChildren()
  } finally {
    allowCleanup()
    await rm(ready, { force: true })
  }
  const error = await outcome
  assert.equal(error?.code, 'BUILD_SIGNALLED', 'the build call returned 0 but was signalled')
  assert.equal(m.builds[0].state, 'pending')
  assert.equal(unresolvedBuilds(m).length, 1)
  assert.throws(() => assertBuildsResolved(m), { code: 'BUILD_UNRESOLVED' })
})

test('a build that finishes without any signal still settles with the real executor', async () => {
  const m = stand()
  const { persist } = recorder()
  await runBuild(m, () => run(process.execPath, ['-e', '0'], { capture: true }), persist)
  assert.equal(m.builds[0].state, 'settled')
})

test('no code path can write a settled failure without engine-side evidence', async () => {
  const source = await readFile(new URL('./build-intent.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /outcome:\s*'(failed|error|canceled)'/)
  assert.doesNotMatch(source, /state:\s*'settled'[\s\S]{0,80}failed/)
})
