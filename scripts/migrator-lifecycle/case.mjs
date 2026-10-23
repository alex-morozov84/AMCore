import assert from 'node:assert/strict'
import { migration } from './fixture.mjs'
import { isolatedContainer } from './docker.mjs'
import { closeAttached, naturalExit } from './exit.mjs'
import { launch, activeSql } from './process.mjs'
import { removeContainer } from './resources.mjs'
import { checkpoint, report, safeError, withClient } from './safety.mjs'

async function ledger(f, test, transactional) {
  const url = new URL(f.database.getConnectionUri())
  url.pathname = `/${test.name}`
  await withClient(f, url.href, async (client) => {
    const result = await client.query('SELECT finished_at FROM _prisma_migrations')
    assert.equal(result.rows.length, 1, 'Unexpected migration ledger count')
    assert.equal(result.rows[0].finished_at, null, 'Cancelled migration marked finished')
    if (transactional) {
      const { rows } = await client.query(
        "SELECT to_regclass('public.cancellation_probe') AS probe"
      )
      assert.equal(rows[0].probe, null, 'Transactional table/data survived cancellation')
    }
  })
}

export async function runCase(f, transactional, signal) {
  const name = `${transactional ? 'transaction' : 'statement'}_${signal.toLowerCase()}`
  let attempt,
    failure,
    signalResult,
    phase = 'migration-fixture'
  try {
    checkpoint(f)
    const test = await migration(f, name, transactional)
    checkpoint(f)
    phase = 'launch'
    attempt = launch(f, test)
    phase = 'active-sql'
    const active = await activeSql(f, test.name, attempt)
    report(f, 'OBSERVED_SLEEP', { case: name, active })
    const container = await isolatedContainer(f, attempt.name)
    checkpoint(f)
    phase = 'cancellation'
    // Attach rejection handling immediately, but never await signal completion
    // before the exit-triggered 200ms database observation.
    signalResult = f.docker(['container', 'kill', '--signal', signal, container.Id]).then(
      () => ({}),
      (error) => ({ error })
    )
    const exit = await naturalExit(attempt)
    const observed = await attempt.observed
    if (observed.error) throw observed.error
    assert.equal(observed.result.sessions, 0, 'Database session survived cancellation')
    assert.equal(observed.result.locks, 0, 'Database lock survived cancellation')
    assert.equal(exit.signal, null, 'Attached client was terminated by harness')
    assert.ok(exit.code > 0 && exit.elapsed < 45000, 'Require natural nonzero exit before 45s')
    const sent = await signalResult
    if (sent.error) throw sent.error
    const state = (await isolatedContainer(f, attempt.name)).State
    assert.equal(state.Running, false, 'Container still running')
    assert.equal(state.OOMKilled, false, 'Container OOM killed')
    assert.equal(state.ExitCode, exit.code, 'Container exit code mismatch')
    phase = 'ledger'
    await ledger(f, test, transactional)
    checkpoint(f)
    report(f, 'PASS', {
      case: name,
      architecture: f.artifact.Architecture,
      active,
      exit: exit.code,
      attachToExitMs: exit.elapsed,
      ...observed,
      result: observed.result,
    })
  } catch (error) {
    failure = error
    // Persist the original verdict before diagnostic rm/kill or client close.
    report(f, f.interrupted ? 'ERROR' : 'FAIL', { case: name, phase, error: safeError(error) })
  }
  const cleanupErrors = []
  if (attempt) {
    attempt.cancellation.abort()
    try {
      await removeContainer(f, attempt.name)
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      await closeAttached(attempt, (error) =>
        report(f, 'CLEANUP_ERROR', {
          case: name,
          phase: 'attached-client',
          journal: f.journalPath,
          error: safeError(error),
        })
      )
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (signalResult) {
    const sent = await signalResult // dockerClient has its own 10s bound.
    if (sent.error && sent.error !== failure) {
      failure = new AggregateError([...(failure ? [failure] : []), sent.error], 'Signal failed')
    }
  }
  if (cleanupErrors.length) {
    report(f, 'CLEANUP_ERROR', {
      case: name,
      journal: f.journalPath,
      errors: cleanupErrors.map(safeError),
    })
  }
  if (failure || cleanupErrors.length) {
    throw new AggregateError(
      [...(failure ? [failure] : []), ...cleanupErrors],
      'Lifecycle case failed'
    )
  }
}
