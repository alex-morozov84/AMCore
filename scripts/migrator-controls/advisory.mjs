import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { root } from '../migrator-operations/context.mjs'
import { journal } from './context.mjs'
import { resources, dispose, removeContainer } from '../migrator-lifecycle/resources.mjs'
import { fixture, migration } from '../migrator-lifecycle/fixture.mjs'
import { launch, activeSql } from '../migrator-lifecycle/process.mjs'
import { naturalExit, closeAttached } from '../migrator-lifecycle/exit.mjs'
import { owned } from '../migrator-lifecycle/docker.mjs'
import { safeError, closeClient } from '../migrator-lifecycle/safety.mjs'
const { Client } = createRequire(`${root}/apps/api/package.json`)('pg')

export async function advisory(image) {
  const f = await resources(journal())
  let attempt, locker
  const emit = (x) => console.log(JSON.stringify({ run: f.run, ...x }))
  async function remove() {
    if (!attempt) return
    attempt.cancellation.abort()
    await removeContainer(f, attempt.name)
    await closeAttached(attempt, (error) =>
      emit({ verdict: 'CLEANUP_ERROR', error: safeError(error) })
    )
    attempt = undefined
  }
  async function signal(attempt, kind) {
    const c = await owned(f, 'container', attempt.name)
    return f.docker(['container', 'kill', '--signal', kind, c.Id]).then(
      () => ({}),
      (error) => ({ error })
    )
  }
  try {
    await fixture(f, image)
    const primer = await migration(f, 'statement_term', false)
    attempt = launch(f, primer)
    const active = await activeSql(f, primer.name, attempt)
    const lock = (
      await f.observer.query(
        `SELECT classid::bigint::text,objid::bigint::text,objsubid FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted`,
        [active.pid]
      )
    ).rows
    assert.equal(lock.length, 1)
    const key = ((BigInt(lock[0].classid) << 32n) | BigInt(lock[0].objid)).toString()
    const sent = signal(attempt, 'TERM'),
      exit = await naturalExit(attempt),
      observed = await attempt.observed
    if (observed.error) throw observed.error
    assert.deepEqual(observed.result, { sessions: 0, locks: 0 })
    assert.ok(exit.code > 0 && exit.elapsed < 45000)
    assert.equal((await sent).error, undefined)
    emit({ check: 'derive-actual-prisma-advisory-key', verdict: 'PASS', key, exit, observed })
    await remove()
    for (const [kind, name] of [
      ['TERM', 'statement_int'],
      ['INT', 'transaction_term'],
    ]) {
      const test = await migration(f, name, false),
        url = new URL(f.database.getConnectionUri())
      url.pathname = `/${name}`
      locker = new Client({
        connectionString: url.href,
        connectionTimeoutMillis: 10000,
        query_timeout: 5000,
      })
      await locker.connect()
      await locker.query('SELECT pg_advisory_lock($1::bigint)', [key])
      attempt = launch(f, test)
      let waiting
      const deadline = performance.now() + 15000
      while (performance.now() < deadline) {
        waiting = (
          await f.observer.query(
            `SELECT pid,state,wait_event_type,wait_event FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND wait_event='advisory'`,
            [name]
          )
        ).rows[0]
        if (waiting) break
        await delay(25)
      }
      assert.ok(waiting, 'No actual advisory wait')
      const sent = signal(attempt, kind),
        exit = await naturalExit(attempt),
        observed = await attempt.observed
      if (observed.error) throw observed.error
      assert.ok(exit.code > 0 && exit.elapsed < 45000)
      assert.deepEqual(
        observed.result,
        { sessions: 1, locks: 1 },
        'Only the deliberate blocker may remain'
      )
      assert.equal((await sent).error, undefined)
      assert.equal(
        (
          await f.observer.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1', [
            waiting.pid,
          ])
        ).rows[0].n,
        0
      )
      const ledger = (await locker.query("SELECT to_regclass('public._prisma_migrations') AS name"))
        .rows[0].name
      if (ledger)
        assert.equal(
          (
            await locker.query(
              'SELECT count(*)::int AS n FROM public._prisma_migrations WHERE finished_at IS NOT NULL'
            )
          ).rows[0].n,
          0
        )
      emit({
        check: 'cancel-advisory-wait',
        kind,
        verdict: 'PASS',
        waiting,
        exit,
        observed,
        expectedControlSessions: 1,
        expectedControlLocks: 1,
        explanation:
          'Auxiliary lock fixture; original L1 all-session/all-lock zero admission remains separate and unchanged',
      })
      await remove()
      await closeClient(locker)
      locker = undefined
      const final = (
        await f.observer.query(
          `SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname=$1) AS sessions,(SELECT count(*)::int FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=$1)) AS locks`,
          [name]
        )
      ).rows[0]
      assert.deepEqual(final, { sessions: 0, locks: 0 })
      emit({ check: 'advisory-control-post-disposal', kind, verdict: 'PASS', final })
    }
  } catch (error) {
    emit({ verdict: 'ERROR', error: safeError(error) })
    process.exitCode = 1
  } finally {
    if (attempt) {
      emit({ verdict: 'ERROR', phase: 'before-diagnostic-cleanup' })
      await remove()
    }
    await closeClient(locker)
    await dispose(f)
  }
}
