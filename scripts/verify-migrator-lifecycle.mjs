import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { fixture, migration, dispose } from './migrator-lifecycle/fixture.mjs'
import { launch, activeSql, owned, naturalExit, remove } from './migrator-lifecycle/process.mjs'

const [image] = process.argv.slice(2)
if (!image) throw new Error('Usage: node scripts/verify-migrator-lifecycle.mjs IMAGE')
const f = await fixture(image)
try {
  for (const transactional of [false, true]) {
    for (const signal of ['TERM', 'INT']) {
      const test = await migration(
        f,
        `${transactional ? 'transaction' : 'statement'}_${signal.toLowerCase()}`,
        transactional
      )
      const attempt = launch(f, test)
      try {
        await activeSql(f, test.name, attempt)
        const container = owned(f, attempt.name)
        f.docker(['container', 'kill', '--signal', signal, container.Id])
        const exit = await naturalExit(attempt)
        // Preserve the original observation: no inspect, polling or cleanup
        // between attached-process exit and this fixed 200ms delay.
        await delay(200)
        const observationDelayMs = performance.now() - attempt.started - exit.elapsed
        const {
          rows: [observed],
        } = await f.observer.query(
          `SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname=$1) AS sessions,
            (SELECT count(*)::int FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=$1)) AS locks`,
          [test.name]
        )
        assert.equal(observed.sessions, 0, 'Database session survived cancellation')
        assert.equal(observed.locks, 0, 'Database lock survived cancellation')
        assert.equal(exit.signal, null, 'The attached client was terminated by the harness')
        assert.ok(
          exit.code > 0 && exit.elapsed < 45000,
          'Signal must produce natural nonzero exit before 45s'
        )
        const state = owned(f, attempt.name).State
        assert.equal(state.Running, false)
        assert.equal(state.OOMKilled, false)
        assert.equal(state.ExitCode, exit.code)
        const ledgerUrl = new URL(f.database.getConnectionUri())
        ledgerUrl.pathname = `/${test.name}`
        const client = new f.Client({ connectionString: ledgerUrl.href, query_timeout: 5000 })
        await client.connect()
        try {
          const ledger = await client.query('SELECT finished_at FROM _prisma_migrations')
          assert.equal(ledger.rows.length, 1)
          assert.ok(
            ledger.rows.every((row) => row.finished_at === null),
            'Cancelled migration marked finished'
          )
          if (transactional)
            assert.equal(
              (await client.query("SELECT to_regclass('public.cancellation_probe') AS probe"))
                .rows[0].probe,
              null
            )
        } finally {
          await client.end()
        }
        console.log(
          JSON.stringify({
            architecture: f.artifact.Architecture,
            signal,
            transactional,
            exit: exit.code,
            attachToExitMs: exit.elapsed,
            observationDelayMs,
            verdict: 'PASS',
          })
        )
      } finally {
        await remove(f, attempt)
      }
    }
  }
} finally {
  await dispose(f)
}
