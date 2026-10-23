import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { label } from './docker.mjs'
import { watchExit } from './exit.mjs'
import { checkpoint } from './safety.mjs'

export function launch(f, migration) {
  const name = `migrator-lifecycle-${f.run}-${migration.name}`
  f.containers.push(name)
  f.journal() // Durable intent before Docker may create anything.
  const started = performance.now()
  const child = spawn(
    'docker',
    [
      '--host',
      f.endpoint,
      'run',
      '--pull=never',
      '--name',
      name,
      '--label',
      `${label}=${f.run}`,
      '--network',
      f.network,
      '--env',
      'DATABASE_URL',
      '--mount',
      `type=bind,src=${migration.directory},dst=/app/apps/api/prisma,readonly`,
      f.artifact.Id,
    ],
    { env: { ...process.env, DATABASE_URL: migration.url }, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  child.stdout.resume()
  child.stderr.resume()
  const attempt = Object.assign(
    watchExit(child, started, () => observeDatabase(f.observer, migration.name)),
    { name }
  )
  const client = { name, pid: child.pid, closed: false }
  f.clients.push(client)
  f.journal()
  void attempt.closed.then(() => {
    client.closed = true
  }) // No I/O in the observation window.
  return attempt
}

export async function activeSql(f, database, attempt) {
  while (performance.now() - attempt.started < 30000) {
    checkpoint(f)
    if (attempt.error) throw attempt.error
    assert.equal(attempt.child.exitCode, null, 'Migrator exited before active SQL')
    const { rows } = await f.observer.query(
      `SELECT pid, state, wait_event_type, wait_event FROM pg_stat_activity
       WHERE datname=$1 AND state='active' AND wait_event_type='Timeout' AND wait_event='PgSleep'`,
      [database]
    )
    if (rows.length) {
      assert.equal(rows.length, 1, 'Expected exactly one sleeping migration session')
      return rows[0] // Safe fields, no query text, user or connection URL.
    }
    await delay(25)
  }
  throw Object.assign(new Error('No confirmed PgSleep'), { code: 'ACTIVE_SQL_TIMEOUT' })
}

export async function observeDatabase(observer, database) {
  const {
    rows: [observed],
  } = await observer.query(
    `SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname=$1) AS sessions,
      (SELECT count(*)::int FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=$1)) AS locks`,
    [database]
  )
  return observed
}
